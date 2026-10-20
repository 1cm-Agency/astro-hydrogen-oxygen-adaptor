import { Cache, type CachingStrategy, type I18nConfig } from '@shopify/hydrogen';
import type { CacheHint, LiveDataCollection, LiveDataEntry } from 'astro';
import type { LiveLoader } from 'astro/loaders';
import { entryByHandleQuery, entryByIdQuery, listQuery, type Resource } from './queries.js';
import { mergeI18n, run, ShopifyLoaderError, toEntry, withContext, type ShopifyEntry } from './shared.js';
import { defaultI18n, getCatalogClient } from './storefront.js';

/** A cache hint with the sub-request cache window. Astro's own `Astro.cache.set()` ignores `maxAge`/`swr` from a hint; use `shopifyCacheOptions`. */
export type ShopifyCacheHint = CacheHint & { maxAge?: number; swr?: number };

export interface ShopifyCollectionFilter {
  /** Storefront search syntax, e.g. `tag:featured`. */
  query?: string;
  /** Page size for this request. */
  first?: number;
  /** A cursor from a previous page's `pageInfo`, for custom pagination. */
  after?: string;
  sortKey?: string;
  reverse?: boolean;
  /** Overrides the market's country (ISO 3166 alpha-2, e.g. `CA`). */
  country?: string;
  /** Overrides the market's language (e.g. `FR`). */
  language?: string;
  /** Extra variables for a generic query. */
  [variable: string]: unknown;
}

export interface ShopifyEntryFilter {
  /** The entry ID (the handle, or `blog/article-handle` for articles), or a global ID (`gid://shopify/...`). */
  id?: string;
  /** The handle. Articles take `blog-handle/article-handle`. */
  handle?: string;
  country?: string;
  language?: string;
}

interface Common {
  /** Sub-request cache strategy for every query. @default Cache.short() */
  cache?: CachingStrategy;
  /** Market for prices and translations; the filter can override it per call. */
  i18n?: I18nConfig;
}

export interface ShopifyLiveResourceOptions extends Common {
  resource: Resource;
  /** Default page size. @default 20 */
  first?: number;
}

export interface ShopifyLiveQueryOptions extends Common {
  /** The query for `loadCollection`. Collection filter keys become variables. */
  query: string;
  variables?: Record<string, unknown>;
  /** Maps a response to entries. */
  entries: (data: any) => ShopifyEntry[];
  /** The query for `loadEntry`, if different. Entry filter keys become variables. @default `query` */
  entryQuery?: string;
  /** Maps an entry response to an entry. @default the first of `entries(data)` */
  entry?: (data: any) => ShopifyEntry | undefined;
}

export type ShopifyLiveLoaderOptions = ShopifyLiveResourceOptions | ShopifyLiveQueryOptions;

/** `Astro.cache.set()` options (`maxAge`, `swr`) for a Hydrogen strategy. */
export function shopifyCacheOptions(strategy: CachingStrategy = Cache.short()): { maxAge: number; swr?: number } {
  return {
    maxAge: strategy.mode === 'no-store' ? 0 : (strategy.maxAge ?? 0),
    ...(strategy.staleWhileRevalidate ? { swr: strategy.staleWhileRevalidate } : {}),
  };
}

function lastModified(nodes: Array<Record<string, any>>): Date | undefined {
  let latest: Date | undefined;
  for (const node of nodes) {
    const stamp = node.updatedAt ?? node.publishedAt;
    const date = typeof stamp === 'string' ? new Date(stamp) : undefined;
    if (date && !Number.isNaN(date.getTime()) && (!latest || date > latest)) latest = date;
  }
  return latest;
}

function hint(tags: string[], nodes: Array<Record<string, any>>, strategy: CachingStrategy): ShopifyCacheHint {
  const modified = lastModified(nodes);
  return { tags: [...new Set(tags)], ...(modified && { lastModified: modified }), ...shopifyCacheOptions(strategy) };
}

/**
 * A live collection loader for `src/live.config.ts`: reads the catalog at request time through the
 * Worker's sub-request cache. Catalog data only: never use it for carts or customers.
 */
export function shopifyLiveLoader(
  options: ShopifyLiveLoaderOptions,
): LiveLoader<Record<string, any>, ShopifyEntryFilter, ShopifyCollectionFilter, ShopifyLoaderError> {
  const strategy = options.cache ?? Cache.short();
  const resource = 'resource' in options ? options.resource : undefined;
  const collectionTag = `shopify:${resource ?? 'query'}`;
  const clientFor = (filter?: { country?: string; language?: string }) => {
    const i18n = mergeI18n(options.i18n ?? defaultI18n(), filter);
    return { ...getCatalogClient({ i18n }), i18n };
  };
  const asEntry = (entry: ShopifyEntry, extraTags: string[] = []): LiveDataEntry => ({
    id: entry.id,
    data: entry.data,
    ...(entry.rendered && { rendered: entry.rendered }),
    cacheHint: hint([String(entry.data.id ?? entry.id), ...extraTags], [entry.data], strategy),
  });

  return {
    name: 'astro-hydrogen/shopify-live',

    async loadCollection({ filter }): Promise<LiveDataCollection | { error: ShopifyLoaderError }> {
      try {
        const { country, language, first, query: search, sortKey, reverse, after, ...rest } = filter ?? {};
        const { client, i18n } = clientFor({ country, language });
        let query: string;
        let variables: Record<string, unknown>;
        if ('resource' in options) {
          query = listQuery(options.resource);
          variables = { first: first ?? options.first ?? 20, after, query: search, sortKey, reverse };
        } else {
          query = options.query;
          variables = { ...options.variables, ...(first !== undefined && { first }), ...(after !== undefined && { after }), ...rest };
        }
        const data = await run(client, query, withContext(query, variables, i18n), strategy);
        const entries = 'resource' in options ? (data?.[options.resource]?.nodes ?? []).map((n: any) => toEntry(options.resource, n)) : options.entries(data);
        return {
          entries: entries.map((entry: ShopifyEntry) => asEntry(entry)),
          cacheHint: hint([collectionTag], entries.map((e: ShopifyEntry) => e.data), strategy),
        };
      } catch (error) {
        return { error: toLoaderError(error) };
      }
    },

    async loadEntry({ filter }): Promise<LiveDataEntry | undefined | { error: ShopifyLoaderError }> {
      try {
        const { country, language, id, handle, ...rest } = (filter ?? {}) as ShopifyEntryFilter & Record<string, unknown>;
        const { client, i18n } = clientFor({ country, language });
        let entry: ShopifyEntry | undefined;
        if ('resource' in options) {
          const key = handle ?? id;
          if (!key) return undefined;
          let node: Record<string, any> | undefined | null;
          if (key.startsWith('gid://')) {
            const query = entryByIdQuery(options.resource);
            node = (await run(client, query, withContext(query, { id: key }, i18n), strategy))?.node;
          } else if (options.resource === 'articles') {
            const [blog, ...articleHandle] = key.split('/');
            if (!articleHandle.length) return undefined;
            const query = entryByHandleQuery('articles');
            node = (await run(client, query, withContext(query, { blog, handle: articleHandle.join('/') }, i18n), strategy))?.blog
              ?.articleByHandle;
          } else {
            const query = entryByHandleQuery(options.resource);
            const field = { products: 'product', collections: 'collection', pages: 'page' }[options.resource];
            node = (await run(client, query, withContext(query, { handle: key }, i18n), strategy))?.[field];
          }
          if (node) entry = toEntry(options.resource, node);
        } else {
          const query = options.entryQuery ?? options.query;
          const variables = { ...options.variables, ...(id !== undefined && { id }), ...(handle !== undefined && { handle }), ...rest };
          const data = await run(client, query, withContext(query, variables, i18n), strategy);
          entry = options.entry ? options.entry(data) : options.entries(data)[0];
        }
        return entry ? asEntry(entry, [collectionTag]) : undefined;
      } catch (error) {
        return { error: toLoaderError(error) };
      }
    },
  };
}

function toLoaderError(error: unknown): ShopifyLoaderError {
  return error instanceof ShopifyLoaderError
    ? error
    : new ShopifyLoaderError(error instanceof Error ? error.message : String(error), [], { cause: error });
}
