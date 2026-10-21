import {
  createStorefrontClient,
  type ShopifyRequestContextWithBuyerIp,
} from '@shopify/hydrogen';
import type { HydrogenStorefrontArgs, HydrogenStorefrontClient, OxygenEnv } from '../config.js';

const MOCK_SHOP_DOMAIN = 'mock.shop';
let warnedAboutMockShop = false;

/**
 * Picks the most capable client the environment allows:
 * - `private` with a private token and a trusted buyer IP (SSR on Oxygen)
 * - `private_no_buyer_context` with a private token while prerendering
 * - `public` otherwise, tokenless when `PUBLIC_STOREFRONT_API_TOKEN` is unset
 */
export function createDefaultStorefrontClient({
  env,
  requestContext,
  buyerIp,
  isPrerendered,
  cache,
  waitUntil,
}: HydrogenStorefrontArgs): HydrogenStorefrontClient {
  const storeDomain = readString(env, 'PUBLIC_STORE_DOMAIN') ?? useMockShop();
  const privateStorefrontToken = readString(env, 'PRIVATE_STOREFRONT_API_TOKEN');
  // Shared by every client type: the storefront ID header and sub-request caching.
  const shared = { storefrontId: readString(env, 'PUBLIC_STOREFRONT_ID'), cache, waitUntil };

  if (privateStorefrontToken && buyerIp) {
    return createStorefrontClient({
      type: 'private',
      // The middleware creates the context with `buyerIp` whenever one is available.
      requestContext: requestContext as ShopifyRequestContextWithBuyerIp,
      config: { storeDomain, privateStorefrontToken, ...shared },
    });
  }

  if (privateStorefrontToken && isPrerendered) {
    return createStorefrontClient({
      type: 'private_no_buyer_context',
      requestContext,
      config: { storeDomain, privateStorefrontToken, ...shared },
    });
  }

  return createStorefrontClient({
    type: 'public',
    requestContext,
    config: {
      storeDomain,
      publicStorefrontToken: readString(env, 'PUBLIC_STOREFRONT_API_TOKEN'),
      ...shared,
    },
  });
}

/** Empty strings count as unset: env loaders parse `KEY=` as `""`, which the client rejects. */
function readString(env: OxygenEnv, key: string): string | undefined {
  const value = env[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function useMockShop(): string {
  if (!warnedAboutMockShop) {
    warnedAboutMockShop = true;
    console.warn(
      `[astro-hydrogen] PUBLIC_STORE_DOMAIN is not set; using the tokenless ${MOCK_SHOP_DOMAIN} demo store. ` +
        'Link your storefront with `npx shopify hydrogen link` and `npx shopify hydrogen env pull`, or set it in `.env`.',
    );
  }
  return MOCK_SHOP_DOMAIN;
}
