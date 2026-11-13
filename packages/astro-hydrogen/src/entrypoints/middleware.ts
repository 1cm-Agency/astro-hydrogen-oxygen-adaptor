/**
 * Injected by the adapter with `order: 'pre'`, so it runs before your own `src/middleware.ts`.
 *
 * Request -> handleShopifyRoutes() -> Astro routing -> handleShopifyRedirects() on 404
 */
import type { MiddlewareHandler } from 'astro';
import type { HydrogenLocals } from '../config.js';
import { matchShopifyRedirect, matchShopifyRoute, prepareHydrogenRequest } from '../runtime/hydrogen-request.js';
import type { ShopifyRequestContext } from '@shopify/hydrogen';

/** The route Astro serves `server:defer` components from. */
const SERVER_ISLAND_ROUTE = '/_server-islands/[name]';

export const onRequest: MiddlewareHandler = async (context, next) => {
  const locals = context.locals as HydrogenLocals;
  const isPrerendered = context.isPrerendered;
  const prepared = await prepareHydrogenRequest({
    request: context.request,
    url: context.url,
    runtime: locals.oxygen,
    isPrerendered,
  });

  locals.storefront = prepared.storefront;
  locals.shopifyRequestContext = prepared.requestContext;

  if (isPrerendered) return next();

  // A server island exists to render what the cached page around it cannot: the buyer's own content.
  // Route rules match its URL like any other path, and every buyer of a cached page requests the
  // same island URL, so drop whatever a rule seeded. `Astro.cache.set()` inside the island opts back in.
  if (context.routePattern === SERVER_ISLAND_ROUTE && context.cache?.enabled) context.cache.set(false);

  const sessionManager = prepared.sessionManager!;
  // Reading any of these makes the response buyer-specific, so it must not be stored in a shared cache.
  const buyerScoped = {
    buyer: () => prepared.buyer,
    shopifySession: () => sessionManager,
    ...(prepared.customerSession && {
      customerSession: () => prepared.customerSession,
      // Also lazy in `prepared`: creating the client validates the request origin.
      customerAccount: () => prepared.customerAccount,
    }),
  };
  for (const [key, read] of Object.entries(buyerScoped)) {
    Object.defineProperty(locals, key, {
      enumerable: true,
      configurable: true,
      get() {
        prepared.requestContext.markResponseAsPersonalized(`Astro.locals.${key}`);
        return read();
      },
      // Your own middleware may replace a value; it is then yours to keep out of caches.
      set(value) {
        Object.defineProperty(locals, key, { value, enumerable: true, configurable: true, writable: true });
      },
    });
  }

  const shopifyRoute = await matchShopifyRoute(context.request, prepared);
  if (shopifyRoute) return shopifyRoute;

  const response = await next();

  if (response.status === 404) {
    const redirect = await matchShopifyRedirect(context.request, prepared);
    if (redirect) return redirect;
  }

  return finalizeResponse(response, prepared.requestContext, await sessionManager.commit?.());
};

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
    // Hydrogen makes personalized responses private, but Oxygen's full-page cache reads its own
    // header, which Hydrogen leaves alone. Never let a private response into that cache.
    if (/\b(private|no-store)\b/i.test(target.headers.get('cache-control') ?? '')) {
      target.headers.delete('oxygen-cache-control');
    }
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
