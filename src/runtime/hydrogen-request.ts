/**
 * Per-request Hydrogen setup, shared by the injected middleware and by the Worker entry, which
 * serves Hydrogen routes for URLs that match no Astro route when `404.astro` is prerendered
 * (Astro then renders its error page without running middleware).
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
import { createCustomerAccountClient } from '@shopify/hydrogen/customer-account';
import type { HydrogenLocals, HydrogenRequestArgs, HydrogenSessionManager, OxygenEnv, OxygenRuntime } from '../config.js';
import { createCookieSessionManager } from './cookie-session.js';
import { getCustomerAccountSetup, MISSING } from './customer-account.js';
import { getOxygenBuyer } from './buyer.js';
import { getClientIp } from './client-ip.js';
import { getMemoryCache } from './memory-cache.js';
import { createRequestSessionManager } from './session.js';
import { createDefaultStorefrontClient } from './storefront.js';
import { config, routeTemplates as customRouteTemplates } from './user-config.js';

const DEFAULT_I18N: I18nConfig = { country: 'US', language: 'EN' };

const routeTemplates = customRouteTemplates ?? createShopifyRouteTemplates({});
let defaultHandlers: readonly ShopifyRouteHandlerGroup[] | undefined;
const customerAccountEnabled = Boolean(config.customerAccount);

export interface PrepareArgs {
  request: Request;
  url: URL;
  runtime: OxygenRuntime | undefined;
  isPrerendered: boolean;
}

/** What the middleware puts on `locals`, plus what the Shopify route handlers need. */
export interface HydrogenRequest {
  storefront: HydrogenLocals['storefront'];
  requestContext: ShopifyRequestContext;
  /** The rest is undefined while prerendering. */
  buyer?: HydrogenLocals['buyer'];
  sessionManager?: HydrogenSessionManager;
  customerSession?: HydrogenLocals['customerSession'];
  customerAccount?: HydrogenLocals['customerAccount'];
  handlers?: readonly ShopifyRouteHandlerGroup[];
}

export async function prepareHydrogenRequest({ request, url, runtime, isPrerendered }: PrepareArgs): Promise<HydrogenRequest> {
  const args: HydrogenRequestArgs = {
    request,
    url,
    env: runtime?.env ?? (globalThis.process?.env as OxygenEnv | undefined) ?? {},
    runtime,
    isPrerendered,
  };

  const i18n = typeof config.i18n === 'function' ? await config.i18n(args) : (config.i18n ?? DEFAULT_I18N);
  const buyerIp = isPrerendered ? undefined : (config.getBuyerIp ?? defaultGetBuyerIp)(args);

  // A prerendered page has no buyer: its request carries build-time headers only.
  const contextRequest = isPrerendered ? { headers: new Headers() } : request;
  const requestContext: ShopifyRequestContext = buyerIp
    ? createShopifyRequestContext({ request: contextRequest, i18n, buyerIp })
    : createShopifyRequestContext({ request: contextRequest, i18n });

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

  if (isPrerendered) return { storefront, requestContext };

  const buyer = getOxygenBuyer(request.headers, buyerIp);

  const secret = typeof args.env.SESSION_SECRET === 'string' ? args.env.SESSION_SECRET : '';
  if (customerAccountEnabled && !config.sessionManager && !secret) throw new Error(MISSING('SESSION_SECRET'));
  const sessionManager = config.sessionManager
    ? await config.sessionManager(args)
    : secret
      ? createCookieSessionManager({ request, secret })
      : createRequestSessionManager(request);

  const customerAccount = config.customerAccount
    ? getCustomerAccountSetup(args.env, config.customerAccount)
    : undefined;
  const defaults = customerAccount?.handlers ?? (defaultHandlers ??= [
    createCartServerHandlers(),
    createPredictiveSearchServerHandlers(),
  ]);
  const handlers = typeof config.handlers === 'function' ? await config.handlers({ ...args, defaults }) : (config.handlers ?? defaults);

  const prepared: HydrogenRequest = {
    storefront,
    requestContext,
    buyer,
    sessionManager,
    customerSession: customerAccount?.customerSession,
    handlers,
  };
  if (customerAccount) {
    // Created on first use: Hydrogen rejects non-HTTPS origins (other than localhost) when the
    // client is created, which must not take down pages that never query customer data.
    let client: HydrogenLocals['customerAccount'];
    Object.defineProperty(prepared, 'customerAccount', {
      enumerable: true,
      get: () => (client ??= createCustomerAccountClient({ shopId: customerAccount.shopId, requestContext })),
    });
  }
  return prepared;
}

/**
 * Hydrogen's own routes (`/api/cart`, `/admin`, ...). Returns a response when one matched; it
 * already carries the request context's headers. Needs a request prepared outside prerendering.
 */
export async function matchShopifyRoute(request: Request, prepared: HydrogenRequest): Promise<Response | undefined> {
  if (config.shopifyRoutes === false) return undefined;
  // `handleShopifyRoutes` returns a promise when a route matched, `null` otherwise.
  return (
    (await handleShopifyRoutes({
      request,
      requestContext: prepared.requestContext,
      sessionManager: prepared.sessionManager!,
      storefrontClient: prepared.storefront,
      routeTemplates,
      handlers: prepared.handlers!,
    })) ?? undefined
  );
}

/** A Shopify URL redirect for a path that matched nothing. */
export async function matchShopifyRedirect(request: Request, prepared: HydrogenRequest): Promise<Response | undefined> {
  if (config.shopifyRedirects === false) return undefined;
  return (
    (await handleShopifyRedirects({ request, storefrontClient: prepared.storefront, routeTemplates })) ?? undefined
  );
}

/** For a URL that matches no Astro route: Hydrogen routes first, then Shopify redirects. */
export async function handleUnmatchedRequest({
  request,
  url,
  runtime,
}: {
  request: Request;
  url: URL;
  runtime: OxygenRuntime | undefined;
}): Promise<Response | undefined> {
  const prepared = await prepareHydrogenRequest({ request, url, runtime, isPrerendered: false });
  return (await matchShopifyRoute(request, prepared)) ?? (await matchShopifyRedirect(request, prepared));
}

function defaultGetBuyerIp({ request }: HydrogenRequestArgs): string | undefined {
  return getClientIp(request.headers.get('oxygen-buyer-ip'));
}
