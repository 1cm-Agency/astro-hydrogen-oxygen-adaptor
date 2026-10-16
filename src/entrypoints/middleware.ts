/**
 * Injected by the adapter with `order: 'pre'`, so it runs before your own `src/middleware.ts`.
 *
 * Request -> handleShopifyRoutes() -> Astro routing -> handleShopifyRedirects() on 404
 */
import {
  createCartServerHandlers,
  createPredictiveSearchServerHandlers,
  createShopifyRequestContext,
  createShopifyRouteTemplates,
  handleShopifyRedirects,
  handleShopifyRoutes,
  type I18nConfig,
  type ShopifyRequestContext,
  type ShopifyRouteHandlerGroup,
} from '@shopify/hydrogen';
import type { MiddlewareHandler } from 'astro';
import config from 'virtual:astro-hydrogen/config';
import type { HydrogenLocals, HydrogenRequestArgs, OxygenEnv } from '../config.js';
import { getMemoryCache } from '../runtime/memory-cache.js';
import { createRequestSessionManager } from '../runtime/session.js';
import { createDefaultStorefrontClient } from '../runtime/storefront.js';

const DEFAULT_I18N: I18nConfig = { country: 'US', language: 'EN' };

const routeTemplates = config.routeTemplates ?? createShopifyRouteTemplates({});
let defaultHandlers: readonly ShopifyRouteHandlerGroup[] | undefined;

export const onRequest: MiddlewareHandler = async (context, next) => {
  const locals = context.locals as HydrogenLocals;
  const runtime = locals.oxygen;
  const isPrerendered = context.isPrerendered;
  const args: HydrogenRequestArgs = {
    request: context.request,
    url: context.url,
    env: runtime?.env ?? (globalThis.process?.env as OxygenEnv | undefined) ?? {},
    runtime,
    isPrerendered,
  };

  const i18n = typeof config.i18n === 'function' ? await config.i18n(args) : (config.i18n ?? DEFAULT_I18N);
  const buyerIp = isPrerendered ? undefined : (config.getBuyerIp ?? defaultGetBuyerIp)(args);

  // A prerendered page has no buyer: its request carries build-time headers only.
  const request = isPrerendered ? { headers: new Headers() } : context.request;
  const requestContext: ShopifyRequestContext = buyerIp
    ? createShopifyRequestContext({ request, i18n, buyerIp })
    : createShopifyRequestContext({ request, i18n });

  const storefrontArgs = {
    ...args,
    requestContext,
    buyerIp,
    cache: runtime?.cache ?? getMemoryCache(),
    waitUntil: runtime?.waitUntil,
  };
  const storefront = config.storefront
    ? await config.storefront(storefrontArgs)
    : createDefaultStorefrontClient(storefrontArgs);

  locals.storefront = storefront;
  locals.shopifyRequestContext = requestContext;

  if (isPrerendered) return next();

  const sessionManager = config.sessionManager
    ? await config.sessionManager(args)
    : createRequestSessionManager(context.request);
  locals.shopifySession = sessionManager;

  if (config.shopifyRoutes !== false) {
    const shopifyRoute = handleShopifyRoutes({
      request: context.request,
      requestContext,
      sessionManager,
      storefrontClient: storefront,
      routeTemplates,
      handlers: config.handlers ?? (defaultHandlers ??= [
        createCartServerHandlers(),
        createPredictiveSearchServerHandlers(),
      ]),
    });
    // Matched Shopify responses already carry the request context's headers.
    if (shopifyRoute) return shopifyRoute;
  }

  const response = await next();

  if (response.status === 404 && config.shopifyRedirects !== false) {
    const redirect = await handleShopifyRedirects({
      request: context.request,
      storefrontClient: storefront,
      routeTemplates,
    });
    if (redirect) return redirect;
  }

  return finalizeResponse(response, requestContext, await sessionManager.commit?.());
};

function defaultGetBuyerIp({ request }: HydrogenRequestArgs): string | undefined {
  return request.headers.get('oxygen-buyer-ip')?.split(',')[0]?.trim() || undefined;
}

/** Commit session headers first, then let Hydrogen apply SFAPI cookies and cache safety. */
function finalizeResponse(
  response: Response,
  requestContext: ShopifyRequestContext,
  sessionHeaders: HeadersInit | void,
): Response {
  const apply = (target: Response) => {
    if (sessionHeaders) {
      new Headers(sessionHeaders).forEach((value, key) => target.headers.append(key, value));
    }
    requestContext.applyResponseHeaders(target.headers);
    return target;
  };

  try {
    return apply(response);
  } catch (error) {
    // Responses from `fetch()` or `Response.redirect()` have immutable headers.
    if (!(error instanceof TypeError)) throw error;
    return apply(new Response(response.body, response));
  }
}
