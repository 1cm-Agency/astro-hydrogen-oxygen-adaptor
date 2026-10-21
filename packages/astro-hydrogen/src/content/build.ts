import type { I18nConfig } from '@shopify/hydrogen';
import type { Loader } from 'astro/loaders';
import { listQuery, type Resource } from './queries.js';
import { shopifySchemas } from './schemas.js';
import { findPageInfo, run, toEntry, type ShopifyEntry } from './shared.js';
import { defaultI18n, getCatalogClient } from './storefront.js';

interface Common {
  /** Page size per Storefront request. @default 50 (the API maximum is 250) */
  first?: number;
  /** Stop after this many entries. @default Infinity */
  max?: number;
  /** Market for prices and translations. @default `i18n` from `hydrogen.config.ts` if an object, else US/EN */
  i18n?: I18nConfig;
}

export interface ShopifyResourceLoaderOptions extends Common {
  resource: Resource;
  /** Storefront search syntax, e.g. `tag:featured AND available_for_sale:true`. */
  query?: string;
  sortKey?: string;
  reverse?: boolean;
}

export interface ShopifyQueryLoaderOptions extends Common {
  /** A paginated query: it must take `$first` and `$after` and select `pageInfo { hasNextPage endCursor }`. */
  query: string;
  variables?: Record<string, unknown>;
  /** Maps one response to entries. */
  entries: (data: any) => ShopifyEntry[];
}

export type ShopifyLoaderOptions = ShopifyResourceLoaderOptions | ShopifyQueryLoaderOptions;

/**
 * A build-time collection loader for `src/content.config.ts`: loads Shopify products, collections,
 * pages or articles (or any paginated Storefront query) into the content store.
 */
export function shopifyLoader(options: ShopifyLoaderOptions): Loader {
  const resource = 'resource' in options ? options.resource : undefined;
  return {
    name: 'astro-hydrogen/shopify',
    ...(resource && { schema: shopifySchemas[resource] }),
    async load({ store, parseData, generateDigest, logger }) {
      const { client, i18n } = getCatalogClient({ i18n: options.i18n ?? defaultI18n() });
      const pageSize = options.first ?? 50;
      const max = options.max ?? Infinity;
      const query = 'resource' in options ? listQuery(options.resource) : options.query;
      const base: Record<string, unknown> =
        'resource' in options
          ? { query: options.query, sortKey: options.sortKey, reverse: options.reverse }
          : (options.variables ?? {});

      const seen = new Set<string>();
      let after: string | null | undefined;
      let requests = 0;
      while (seen.size < max) {
        const variables: Record<string, unknown> = {
          ...base,
          first: Math.min(pageSize, max - seen.size),
          after,
          ...(query.includes('$country') && { country: i18n.country }),
          ...(query.includes('$language') && { language: i18n.language }),
        };
        const data = await run(client, query, variables);
        requests++;
        const entries = 'resource' in options ? (data?.[options.resource]?.nodes ?? []).map((n: any) => toEntry(options.resource, n)) : options.entries(data);
        for (const entry of entries) {
          if (seen.size >= max) break;
          const parsed = await parseData({ id: entry.id, data: entry.data });
          store.set({
            id: entry.id,
            data: parsed,
            digest: generateDigest(entry.data),
            ...(entry.body !== undefined && { body: entry.body }),
            ...(entry.rendered && { rendered: entry.rendered }),
          });
          seen.add(entry.id);
        }
        const pageInfo = findPageInfo(data);
        if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
        after = pageInfo.endCursor;
      }

      // Entries that no longer exist in the store of record.
      for (const key of store.keys()) if (!seen.has(key)) store.delete(key);
      logger.info(`Loaded ${seen.size} ${resource ?? 'entries'} in ${requests} request${requests === 1 ? '' : 's'}`);
    },
  };
}
