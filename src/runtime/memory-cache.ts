import type { CacheInstance } from '@shopify/hydrogen';

let memoryCache: CacheInstance | undefined;

/**
 * A process-local cache for when there is no Worker Cache API, i.e. prerendering at build time.
 * It keeps `{ cache: Cache.long() }` queries working there, and dedupes queries across pages.
 */
export function getMemoryCache(): CacheInstance {
  if (memoryCache) return memoryCache;

  const entries = new Map<string, { value: unknown; expiresAt: number }>();
  memoryCache = {
    get(key: string) {
      const entry = entries.get(key);
      if (entry && entry.expiresAt < Date.now()) entries.delete(key);
      return entries.get(key)?.value;
    },
    set(key: string, value: unknown, options?: { ttl?: number }) {
      entries.set(key, { value, expiresAt: Date.now() + (options?.ttl ?? 60) * 1000 });
    },
    delete(key: string) {
      entries.delete(key);
    },
  };
  return memoryCache;
}
