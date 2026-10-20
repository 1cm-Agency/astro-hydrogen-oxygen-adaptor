/**
 * Oxygen module Worker. This is the file `shopify hydrogen deploy` uploads as `dist/server/index.js`,
 * and the entry MiniOxygen executes in `astro dev`, so dev and production share one request path.
 */
import '../runtime/process-shim.js'; // keep first: runs before any dependency evaluates
import type { RouteData } from 'astro';
import { createApp } from 'astro/app/entrypoint';
import { setGetEnv } from 'astro/env/setup';
import { assetBaseUrl, base, cacheName, middleware, prerendered404 } from 'virtual:astro-hydrogen/options';
import type { OxygenEnv, OxygenRuntime } from '../config.js';
import { handleUnmatchedRequest } from '../runtime/hydrogen-request.js';
import { getClientIp } from '../runtime/client-ip.js';
import { fetchPrerenderedPage, isStaticAssetSubrequest } from '../runtime/assets.js';

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

const app = createApp();

export default {
  async fetch(rawRequest: Request, env: OxygenEnv, executionContext: ExecutionContext): Promise<Response> {
    try {
      const request = toPublicRequest(rawRequest);
      setGetEnv((key) => {
        const value = env[key];
        if (typeof value === 'string' || value === undefined) return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        return undefined;
      });

      const waitUntil = executionContext.waitUntil.bind(executionContext);
      const oxygen: OxygenRuntime = { env, waitUntil, cache: await openCache() };

      let routeData: RouteData | undefined;
      if (app.isDev()) {
        routeData = (await app.devMatch(app.getPathnameFromRequest(request)))?.routeData;
      } else {
        routeData = app.match(request);
        // Prerendered pages live with the client assets on Oxygen's CDN, which only serves
        // paths with a file extension at the storefront origin. Serve extensionless page URLs here.
        if (!routeData && !isStaticAssetSubrequest(request) && app.match(request, true)?.prerender) {
          const page = await fetchPrerenderedPage(request, app.removeBase(new URL(request.url).pathname), {
            assetBaseUrl,
            base,
          });
          if (page) return page;
        }
      }

      // With a prerendered 404 page, Astro renders unmatched URLs from the static error page and skips
      // Hydrogen's middleware handling, so its routes and redirects (/api/cart, /admin, ...) run here.
      if (prerendered404 && middleware && !isStaticAssetSubrequest(request) && isUnmatched(request, routeData)) {
        const response = await handleUnmatchedRequest({ request, url: new URL(request.url), runtime: oxygen });
        if (response) return response;
      }

      return await app.render(request, {
        routeData,
        locals: { oxygen },
        waitUntil,
        addCookieHeader: true,
        clientAddress: getClientIp(request.headers.get('oxygen-buyer-ip')),
        prerenderedErrorPageFetch: async (url) => {
          // Astro's error page URL includes `base`; the page lookup wants it stripped.
          const pathname = app.removeBase(new URL(url, request.url).pathname);
          return (
            (await fetchPrerenderedPage(request, pathname, { assetBaseUrl, base })) ??
            new Response('Not found', { status: 404 })
          );
        },
      });
    } catch (error) {
      console.error(error);
      return new Response('An unexpected error occurred', { status: 500 });
    }
  },
};

/**
 * True when no page answers the URL. In production that is no match at all, prerendered or not. In
 * dev `devMatch` falls back to the `/404` route itself, which the middleware sees as a prerendered
 * page, so that match counts as a miss unless `/404` was what the buyer asked for.
 */
function isUnmatched(request: Request, routeData: RouteData | undefined): boolean {
  if (app.isDev()) {
    return !routeData || (routeData.route === '/404' && app.removeBase(new URL(request.url).pathname).replace(/\/+$/, '') !== '/404');
  }
  return !routeData && !app.match(request, true);
}

async function openCache(): Promise<Cache | undefined> {
  try {
    return typeof caches === 'undefined' ? undefined : await caches.open(cacheName);
  } catch {
    return undefined;
  }
}

// Behind a proxy that terminates TLS, such as a tunnel, the Worker sees `http:` with
// `x-forwarded-proto: https`. Customer Account OAuth needs the public `https:` origin.
function toPublicRequest(request: Request): Request {
  const url = new URL(request.url);
  if (url.protocol !== 'http:' || request.headers.get('x-forwarded-proto') !== 'https') {
    return request;
  }
  url.protocol = 'https:';
  return new Request(url, request);
}
