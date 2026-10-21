import { createShopifyRequestContext, type CachingStrategy, type I18nConfig } from '@shopify/hydrogen';
import type { OxygenEnv } from '../config.js';
import { getMemoryCache } from '../runtime/memory-cache.js';
import { createDefaultStorefrontClient } from '../runtime/storefront.js';
import { config } from '../runtime/user-config.js';
import { getWorkerRuntime } from '../runtime/worker-runtime.js';

const FALLBACK_I18N: I18nConfig = { country: 'US', language: 'EN' };

/** The slice of the Storefront client the loaders use. */
export interface CatalogClient {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown>; cache?: CachingStrategy },
  ): Promise<{ data?: any; errors?: ReadonlyArray<{ message: string }> }>;
}

export interface CatalogClientInfo {
  client: CatalogClient;
  i18n: I18nConfig;
}

/** `config.i18n` when it is an object. A function needs a request, which loaders do not have. */
export function defaultI18n(): I18nConfig {
  return typeof config.i18n === 'object' && config.i18n ? config.i18n : FALLBACK_I18N;
}

function currentEnv(): OxygenEnv {
  return getWorkerRuntime()?.env ?? (globalThis.process?.env as OxygenEnv | undefined) ?? {};
}

const clients = new Map<string, { cache: unknown; value: CatalogClientInfo }>();

/**
 * A buyer-less Storefront client for catalog reads: `private_no_buyer_context` with a private token,
 * else `public` (tokenless mock.shop when the store is not configured). Cached per market and
 * environment. Uses the Worker's Cache API inside a Worker and the in-memory cache elsewhere.
 * Cache writes are awaited, since there is no `waitUntil` outside a request.
 */
export function getCatalogClient({ i18n = defaultI18n() }: { i18n?: I18nConfig } = {}): CatalogClientInfo {
  const env = currentEnv();
  const cache = getWorkerRuntime()?.cache ?? getMemoryCache();
  const key = JSON.stringify([
    i18n,
    env.PUBLIC_STORE_DOMAIN,
    env.PUBLIC_STOREFRONT_API_TOKEN,
    env.PRIVATE_STOREFRONT_API_TOKEN,
    env.PUBLIC_STOREFRONT_ID,
  ]);
  const hit = clients.get(key);
  if (hit && hit.cache === cache) return hit.value;

  const requestContext = createShopifyRequestContext({ request: { headers: new Headers() }, i18n });
  const client = createDefaultStorefrontClient({
    env,
    requestContext,
    buyerIp: undefined,
    isPrerendered: true,
    cache,
    waitUntil: undefined,
  } as unknown as Parameters<typeof createDefaultStorefrontClient>[0]) as unknown as CatalogClient;

  const value = { client, i18n };
  clients.set(key, { cache, value });
  return value;
}
