/**
 * Oxygen module Worker. This is the file `shopify hydrogen deploy` uploads as `dist/server/index.js`,
 * and the entry MiniOxygen executes in `astro dev`, so dev and production share one request path.
 */
import { createApp } from 'astro/app/entrypoint';
import { setGetEnv } from 'astro/env/setup';
import { assetBaseUrl, cacheName } from 'virtual:astro-hydrogen/options';
import type { OxygenEnv, OxygenRuntime } from '../config.js';
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

      let routeData;
      if (app.isDev()) {
        routeData = (await app.devMatch(app.getPathnameFromRequest(request)))?.routeData;
      } else {
        routeData = app.match(request);
        // Prerendered pages live with the client assets on Oxygen's CDN, which only serves
        // paths with a file extension at the storefront origin. Serve extensionless page URLs here.
        if (!routeData && !isStaticAssetSubrequest(request) && app.match(request, true)?.prerender) {
          const page = await fetchPrerenderedPage(request, app.removeBase(new URL(request.url).pathname), assetBaseUrl);
          if (page) return page;
        }
      }

      return await app.render(request, {
        routeData,
        locals: { oxygen },
        waitUntil,
        addCookieHeader: true,
        clientAddress: request.headers.get('oxygen-buyer-ip') ?? undefined,
        prerenderedErrorPageFetch: async (url) => {
          const pathname = new URL(url, request.url).pathname;
          return (
            (await fetchPrerenderedPage(request, pathname, assetBaseUrl)) ??
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
