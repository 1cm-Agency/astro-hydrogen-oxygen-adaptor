import type {
  CacheInstance,
  CachingStrategy,
  I18nConfig,
  ShopifyRequestContext,
  ShopifyRouteHandlerGroup,
  ShopifyRouteTemplates,
  StorefrontClient,
} from '@shopify/hydrogen';

/**
 * Environment variables and secrets for the current request.
 *
 * On Oxygen (and in `astro dev` / `astro preview`, which run on MiniOxygen) these are the
 * Worker's environment bindings. Oxygen injects the `PUBLIC_*`, `PRIVATE_*` and `SESSION_SECRET`
 * values automatically for a linked storefront. During prerendering at build time they fall back
 * to `process.env`, which the adapter populates from your `.env` files.
 */
export interface OxygenEnv {
  PUBLIC_STORE_DOMAIN?: string;
  PUBLIC_STOREFRONT_API_TOKEN?: string;
  PRIVATE_STOREFRONT_API_TOKEN?: string;
  PUBLIC_STOREFRONT_ID?: string;
  PUBLIC_CHECKOUT_DOMAIN?: string;
  SESSION_SECRET?: string;
  /** The shop's ID, which `<ShopifyScripts />` needs for analytics. */
  SHOP_ID?: string;
  [key: string]: unknown;
}

/** The Oxygen Worker values for the current request, exposed as `Astro.locals.oxygen`. */
export interface OxygenRuntime {
  env: OxygenEnv;
  /** Keeps background work, such as cache revalidation, alive after the response is sent. */
  waitUntil: (promise: Promise<unknown>) => void;
  /** The Worker Cache API store that Hydrogen uses for sub-request caching. */
  cache: Cache | undefined;
}

/** The Storefront client on `Astro.locals.storefront`. Queries accept a `cache` strategy. */
export type HydrogenStorefrontClient = StorefrontClient<{ cache?: CachingStrategy }>;

/** What the adapter puts on `Astro.locals`. */
export interface HydrogenLocals {
  /** Oxygen Worker values. Undefined while prerendering at build time. */
  oxygen?: OxygenRuntime;
  /** Request-scoped Hydrogen Storefront API client. */
  storefront: HydrogenStorefrontClient;
  /** The request context the Storefront client uses. */
  shopifyRequestContext: ShopifyRequestContext;
  /** The session Hydrogen route handlers use. Undefined while prerendering. */
  shopifySession?: HydrogenSessionManager;
  /** Where the buyer is, from Oxygen's `oxygen-buyer-*` headers. Undefined while prerendering. */
  buyer?: OxygenBuyer;
}

/**
 * The buyer's location as Oxygen geolocates it. A field is undefined when Oxygen sends no value.
 * Locally, MiniOxygen fills these with San Francisco defaults.
 */
export interface OxygenBuyer {
  /** The IP address from your `getBuyerIp` hook; `oxygen-buyer-ip` by default. */
  ip?: string;
  /** ISO 3166-1 alpha-2 country code, such as `US`. */
  country?: string;
  /** Region name, such as `California`. */
  region?: string;
  /** Region code, such as `CA`. */
  regionCode?: string;
  city?: string;
  postalCode?: string;
  /** Continent code, such as `NA`. */
  continent?: string;
  latitude?: number;
  longitude?: number;
  /** IANA time zone, such as `America/Los_Angeles`. */
  timezone?: string;
  /** Nielsen DMA code, US only. */
  metroCode?: string;
  isEuCountry: boolean;
}

/** The session storage Hydrogen route handlers read and write. */
export type HydrogenSessionManager = Parameters<
  typeof import('@shopify/hydrogen').handleShopifyRoutes
>[0]['sessionManager'];

/** The values every config hook receives. */
export interface HydrogenRequestArgs {
  request: Request;
  url: URL;
  env: OxygenEnv;
  /** Undefined while prerendering at build time, when there is no Worker. */
  runtime: OxygenRuntime | undefined;
  /** True while Astro prerenders a page at build time; there is no real request or buyer. */
  isPrerendered: boolean;
}

export interface HydrogenStorefrontArgs extends HydrogenRequestArgs {
  requestContext: ShopifyRequestContext;
  buyerIp: string | undefined;
  /** Oxygen's Worker cache, or an in-memory cache while prerendering. Pass it to the client config. */
  cache: CacheInstance;
  /** Pass to the client config with `cache` for background revalidation. */
  waitUntil: ((promise: Promise<unknown>) => void) | undefined;
}

export interface HydrogenConfig {
  /**
   * The request's country, language and optional path prefix. Pass a function to derive it
   * from the URL or headers, e.g. for `/en-ca/...` subfolder markets.
   * @default { country: 'US', language: 'EN' }
   */
  i18n?: I18nConfig | ((args: HydrogenRequestArgs) => I18nConfig | Promise<I18nConfig>);

  /**
   * Returns the trusted buyer IP that private Storefront API clients forward to Shopify.
   * @default the `oxygen-buyer-ip` header, which Oxygen and MiniOxygen set
   */
  getBuyerIp?: (args: HydrogenRequestArgs) => string | undefined;

  /**
   * Replaces the default Storefront client. The default picks a `private` client when
   * `PRIVATE_STOREFRONT_API_TOKEN` and a buyer IP are available, `private_no_buyer_context`
   * while prerendering, and otherwise a `public` (or tokenless) client. It always wires
   * `cache` and `waitUntil` for sub-request caching; do the same in a custom client.
   */
  storefront?: (args: HydrogenStorefrontArgs) => HydrogenStorefrontClient | Promise<HydrogenStorefrontClient>;

  /**
   * Request-scoped session storage for Hydrogen route handlers (required for Customer Account
   * handlers). Its `commit()` headers are appended to every response.
   * @default an in-memory, per-request session
   */
  sessionManager?: (args: HydrogenRequestArgs) => HydrogenSessionManager | Promise<HydrogenSessionManager>;

  /**
   * Hydrogen route handler groups served before Astro routing.
   * @default cart (`/api/cart`) and predictive search (`/api/predictive-search`) handlers
   */
  handlers?: readonly ShopifyRouteHandlerGroup[];

  /**
   * The app's non-standard Shopify resource paths, shared by route handling and redirects.
   * @default {} (Shopify's standard paths)
   */
  routeTemplates?: ShopifyRouteTemplates;

  /**
   * Run `handleShopifyRoutes` before Astro routing (SFAPI proxy, `/cart/...` permalinks,
   * `/checkout`, `/.well-known/ucp`, registered handlers, ...).
   * @default true
   */
  shopifyRoutes?: boolean;

  /**
   * Run `handleShopifyRedirects` when Astro responds with a 404 (`/admin`, store URL redirects,
   * standard route redirects).
   * @default true
   */
  shopifyRedirects?: boolean;
}

/** Type helper for `src/hydrogen.config.ts`. */
export function defineHydrogenConfig(config: HydrogenConfig): HydrogenConfig {
  return config;
}
