import type { CachingStrategy, I18nConfig } from '@shopify/hydrogen';
import type { CatalogClient } from './storefront.js';
import { entryByHandleQuery, entryByIdQuery, htmlOf, entryIdOf, listQuery, type Resource } from './queries.js';

/** A GraphQL or network failure from a content loader. */
export class ShopifyLoaderError extends Error {
  readonly errors: ReadonlyArray<{ message: string }>;
  constructor(message: string, errors: ReadonlyArray<{ message: string }> = [], options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ShopifyLoaderError';
    this.errors = errors;
  }
}

/** An entry as the generic loaders' `entries` callback returns it. */
export interface ShopifyEntry {
  id: string;
  data: Record<string, any>;
  /** Raw body, kept in the store (build-time loader). */
  body?: string;
  /** What `render()` and `<Content />` show. */
  rendered?: { html: string };
}

export function toEntry(resource: Resource, node: Record<string, any>): ShopifyEntry {
  const html = htmlOf(resource, node);
  return { id: entryIdOf(resource, node), data: node, ...(html !== undefined && { rendered: { html } }) };
}

/** Normalizes a market override; Hydrogen expects upper-case codes. */
export function mergeI18n(base: I18nConfig, override?: { country?: string; language?: string }): I18nConfig {
  if (!override?.country && !override?.language) return base;
  return {
    ...base,
    ...(override.country && { country: override.country.toUpperCase() }),
    ...(override.language && { language: override.language.toUpperCase() }),
  } as I18nConfig;
}

/** `$country` and `$language`, only for queries that declare them. */
export function withContext(query: string, variables: Record<string, unknown>, i18n: I18nConfig) {
  return {
    ...(query.includes('$country') && { country: i18n.country }),
    ...(query.includes('$language') && { language: i18n.language }),
    ...variables,
  };
}

/** Runs a query and throws `ShopifyLoaderError` for transport or GraphQL errors. */
export async function run(
  client: CatalogClient,
  query: string,
  variables: Record<string, unknown>,
  cache?: CachingStrategy,
): Promise<any> {
  let result;
  try {
    result = await client.graphql(query, { variables, ...(cache && { cache }) });
  } catch (error) {
    throw new ShopifyLoaderError(`Storefront request failed: ${error instanceof Error ? error.message : String(error)}`, [], {
      cause: error,
    });
  }
  if (result.errors?.length) {
    throw new ShopifyLoaderError(
      `Storefront API error: ${result.errors.map((e) => e.message).join('; ')}`,
      result.errors,
    );
  }
  return result.data;
}

/** The first `pageInfo` object anywhere in a response, for generic queries. */
export function findPageInfo(value: unknown): { hasNextPage?: boolean; endCursor?: string | null } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, any>;
  if (record.pageInfo && typeof record.pageInfo === 'object') return record.pageInfo;
  for (const child of Object.values(record)) {
    const found = findPageInfo(child);
    if (found) return found;
  }
  return undefined;
}

export { entryByHandleQuery, entryByIdQuery, listQuery };
