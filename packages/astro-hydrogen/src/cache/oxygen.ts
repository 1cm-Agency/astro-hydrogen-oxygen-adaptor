/**
 * An Astro route-cache provider (`cache.provider`) backed by Oxygen's Cache API.
 *
 *   import { defineConfig } from 'astro/config';
 *   import hydrogen from 'astro-hydrogen';
 *   import { oxygenCache } from 'astro-hydrogen/cache';
 *
 *   export default defineConfig({
 *     adapter: hydrogen(),
 *     cache: { provider: oxygenCache() },
 *     routeRules: { '/blog/[...path]': { maxAge: 300, swr: 60 } },
 *   });
 *
 * `oxygenCache()` runs in Node (the config). The default export is the provider factory Astro
 * bundles into the Worker, so this file must stay free of `node:` imports.
 *
 * The Cache API has no stale-while-revalidate and no purge by tag. Both are emulated: every entry
 * records when it was stored, its `maxAge` and `swr`, and its tags; `invalidate()` writes a
 * per-tag "invalidated at" marker that `get` compares against. The cache is per data center and
 * evictable, so treat all of it as best-effort.
 */

/** Matches `CacheProviderConfig` from Astro's `cache.provider`. */
export interface OxygenCacheProviderConfig {
  name: string;
  entrypoint: string;
  config: OxygenCacheOptions;
}

export interface OxygenCacheOptions {
  /** Name passed to `caches.open()`. Default `'astro-routes'`. */
  cacheName?: string;
  /** Extra namespace inside the cache, e.g. one per deployment or environment. */
  keyPrefix?: string;
}

/** Module Astro imports in the Worker. Resolved from the project, so it must be a public export. */
export const ENTRYPOINT = 'astro-hydrogen/runtime/oxygen-cache';

export function oxygenCache(options: OxygenCacheOptions = {}): OxygenCacheProviderConfig {
  return { name: 'oxygen', entrypoint: ENTRYPOINT, config: { ...options } };
}

type WaitUntil = (promise: Promise<unknown>) => void;
type Next = () => Promise<Response>;
interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
interface RequestContext {
  request: Request;
  url: URL;
  waitUntil?: WaitUntil;
  logger: Logger;
}
interface InvalidateOptions {
  path?: string;
  tags?: string | string[];
}
export interface OxygenCacheProvider {
  name: string;
  onRequest(context: RequestContext, next: Next): Promise<Response>;
  invalidate(options: InvalidateOptions): Promise<void>;
}

const KEY_HOST = 'https://astro-hydrogen.cache';
/** Stored entries are kept at most this long, whatever `maxAge + swr` says. */
export const MAX_RETENTION_SECONDS = 7 * 24 * 3600;
/** Tag markers must outlive every entry they may need to invalidate. */
const MARKER_TTL_SECONDS = 8 * 24 * 3600;
const PATH_TAG_PREFIX = 'astro-path:';

const H_STORED_AT = 'x-astro-hydrogen-stored-at';
const H_MAX_AGE = 'x-astro-hydrogen-max-age';
const H_SWR = 'x-astro-hydrogen-swr';
const H_TAGS = 'x-astro-hydrogen-tags';
const H_CC = 'x-astro-hydrogen-cache-control';
const META_HEADERS = [H_STORED_AT, H_MAX_AGE, H_SWR, H_TAGS, H_CC];

/** Tracking parameters that never change the page, left out of the key like Astro's memory provider does. */
const IGNORED_PARAM = /^(utm_.*|fbclid|gclid|gbraid|wbraid|dclid|msclkid|twclid|li_fat_id|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|_ke|yclid|ref)$/i;

export function parseCdnCacheControl(header: string | null): { maxAge: number; swr: number } {
  let maxAge = 0;
  let swr = 0;
  for (const part of (header ?? '').split(',')) {
    const directive = part.trim().toLowerCase();
    if (directive.startsWith('max-age=')) maxAge = Number.parseInt(directive.slice(8), 10) || 0;
    else if (directive.startsWith('stale-while-revalidate=')) swr = Number.parseInt(directive.slice(23), 10) || 0;
  }
  return { maxAge, swr };
}

const parseTags = (header: string | null) =>
  (header ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

/** Path (with the sorted, filtered query) that identifies a page in the cache. */
export function pathKey(url: URL): string {
  const params = new URLSearchParams(url.searchParams);
  for (const name of [...params.keys()]) if (IGNORED_PARAM.test(name)) params.delete(name);
  params.sort();
  const query = params.toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Whether the Astro cookie jar attached to `response` holds at least one cookie to send. */
function hasPendingCookies(response: Response): boolean {
  const jar = Reflect.get(response, Symbol.for('astro.cookies')) as { headers(): Iterator<string> } | undefined;
  return jar ? !jar.headers().next().done : false;
}

/** Why `response` must not be stored, or `undefined` when it may be. */
function uncacheableReason(response: Response): string | undefined {
  if (response.status !== 200) return `status ${response.status}`;
  if (response.headers.has('set-cookie') || hasPendingCookies(response)) return 'it sets a cookie';
  const cacheControl = response.headers.get('cache-control') ?? '';
  if (/\b(private|no-store)\b/i.test(cacheControl)) return `Cache-Control: ${cacheControl}`;
  const vary = (response.headers.get('vary') ?? '').toLowerCase();
  if (/(^|[\s,])(cookie|\*)([\s,]|$)/.test(vary)) return `Vary: ${response.headers.get('vary')}`;
  return undefined;
}

export default function oxygenCacheProvider(config?: OxygenCacheOptions): OxygenCacheProvider {
  const cacheName = config?.cacheName ?? 'astro-routes';
  const prefix = (config?.keyPrefix ?? '').replace(/^\/+|\/+$/g, '');
  let opened: Promise<Cache> | undefined;
  let warnedMissing = false;
  const revalidating = new Set<string>();

  const open = () => (opened ??= caches.open(cacheName));
  const requestFor = async (kind: 'page' | 'tag', value: string) =>
    new Request(`${KEY_HOST}/${prefix ? `${prefix}/` : ''}${kind}/${await sha256Hex(value)}`);

  /** `invalidatedAt` for the tags of an entry, newest first match wins. */
  async function isInvalidated(cache: Cache, tags: string[], storedAt: number): Promise<boolean> {
    for (const tag of tags) {
      const marker = await cache.match(await requestFor('tag', tag));
      if (marker && Number(await marker.text()) >= storedAt) return true;
    }
    return false;
  }

  async function store(cache: Cache, key: Request, response: Response, body: ArrayBuffer, maxAge: number, swr: number, tags: string[]) {
    const headers = new Headers(response.headers);
    for (const name of ['content-length', 'cdn-cache-control', 'cache-tag', 'set-cookie', ...META_HEADERS]) {
      headers.delete(name);
    }
    const original = response.headers.get('cache-control');
    if (original) headers.set(H_CC, original);
    headers.set('cache-control', `public, max-age=${Math.min(maxAge + swr, MAX_RETENTION_SECONDS)}`);
    headers.set(H_STORED_AT, String(Date.now()));
    headers.set(H_MAX_AGE, String(maxAge));
    headers.set(H_SWR, String(swr));
    headers.set(H_TAGS, tags.map(encodeURIComponent).join(','));
    await cache.put(key, new Response(body, { status: response.status, headers }));
  }

  function toResponse(cached: Response, state: 'HIT' | 'STALE'): Response {
    const headers = new Headers(cached.headers);
    const original = headers.get(H_CC);
    for (const name of META_HEADERS) headers.delete(name);
    if (original) headers.set('cache-control', original);
    else headers.delete('cache-control');
    headers.set('x-astro-cache', state);
    return new Response(cached.body, { status: cached.status, headers });
  }

  /** Renders, then stores the result when it is cacheable. Returns the response for the client. */
  async function renderAndStore(context: RequestContext, next: Next, cache: Cache | undefined, key: Request | undefined) {
    const response = await next();
    const { maxAge, swr } = parseCdnCacheControl(response.headers.get('cdn-cache-control'));
    if (!cache || !key || maxAge <= 0) return response;
    const reason = uncacheableReason(response);
    if (reason) {
      context.logger.warn(`Skipping cache for ${context.url.pathname}${context.url.search} because ${reason}.`);
      return response;
    }
    const tags = [...new Set([...parseTags(response.headers.get('cache-tag')), PATH_TAG_PREFIX + pathKey(context.url)])];
    // Buffer the body so the stored copy and the client's copy never share a stream.
    const body = await response.arrayBuffer();
    const write = store(cache, key, response, body, maxAge, swr, tags).catch((error) =>
      context.logger.warn(`Could not store ${context.url.pathname} in the Oxygen cache: ${String(error)}`),
    );
    if (context.waitUntil) context.waitUntil(write);
    else await write;
    const headers = new Headers(response.headers);
    headers.set('x-astro-cache', 'MISS');
    return new Response(body, { status: response.status, headers });
  }

  return {
    name: 'oxygen',

    async onRequest(context, next) {
      if (context.request.method !== 'GET') return next();
      if (typeof caches === 'undefined') {
        if (!warnedMissing) {
          warnedMissing = true;
          context.logger.warn('The Cache API is not available here, so the Oxygen route cache is disabled (it works in Oxygen, MiniOxygen and `astro preview`).');
        }
        return next();
      }

      let cache: Cache | undefined;
      let key: Request | undefined;
      try {
        cache = await open();
        key = await requestFor('page', pathKey(context.url));
        const cached = await cache.match(key);
        if (cached) {
          const storedAt = Number(cached.headers.get(H_STORED_AT));
          const maxAge = Number(cached.headers.get(H_MAX_AGE));
          const swr = Number(cached.headers.get(H_SWR));
          const tags = (cached.headers.get(H_TAGS) ?? '').split(',').filter(Boolean).map(decodeURIComponent);
          const age = (Date.now() - storedAt) / 1000;
          if (Number.isFinite(storedAt) && age <= maxAge + swr && !(await isInvalidated(cache, tags, storedAt))) {
            if (age <= maxAge) return toResponse(cached, 'HIT');
            if (context.waitUntil) {
              const { waitUntil } = context;
              const flightKey = key.url;
              if (!revalidating.has(flightKey)) {
                revalidating.add(flightKey);
                const revalidate = renderAndStore(context, next, cache, key)
                  .then((response) => response.body?.cancel())
                  .catch((error) => context.logger.warn(`Background revalidation failed for ${context.url.pathname}: ${String(error)}`))
                  .finally(() => revalidating.delete(flightKey));
                waitUntil(revalidate);
              }
              return toResponse(cached, 'STALE');
            }
            // Without `waitUntil` a Worker may drop background work, so render in the foreground.
          }
        }
      } catch (error) {
        context.logger.warn(`Oxygen cache lookup failed for ${context.url.pathname}: ${String(error)}`);
        cache = undefined;
      }
      return renderAndStore(context, next, cache, key);
    },

    async invalidate(options) {
      if (typeof caches === 'undefined') return;
      const tags = [options.tags ?? []].flat();
      if (options.path) tags.push(PATH_TAG_PREFIX + options.path);
      if (!tags.length) return;
      const cache = await open();
      const body = String(Date.now());
      await Promise.all(
        tags.map(async (tag) =>
          cache.put(
            await requestFor('tag', tag),
            new Response(body, { headers: { 'cache-control': `public, max-age=${MARKER_TTL_SECONDS}` } }),
          ),
        ),
      );
    },
  };
}
