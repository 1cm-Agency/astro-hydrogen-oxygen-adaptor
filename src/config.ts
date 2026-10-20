import type {
  CacheInstance,
  CachingStrategy,
  I18nConfig,
  ShopifyRequestContext,
  ShopifyRouteHandlerGroup,
  ShopifyRouteTemplates,
  StorefrontClient,
} from '@shopify/hydrogen';
import type { CustomerAccountClient, CustomerSession } from '@shopify/hydrogen/customer-account';

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
  /** Encrypts the session cookie. Oxygen injects it for a linked storefront. */
  SESSION_SECRET?: string;
  /** Customer Account API OAuth client ID. Needed by `customerAccount`. */
  PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID?: string;
  /** Base URL for Shopify's OAuth endpoints. Defaults to `https://shopify.com/authentication/{SHOP_ID}`. */
  PUBLIC_CUSTOMER_ACCOUNT_API_URL?: string;
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
  /**
   * The customer session behind the `/account/*` routes: `isLoggedIn`, `getOrRefreshAccessToken`,
   * `logout`. Pass it `Astro.locals.shopifySession` and `Astro.locals.shopifyRequestContext`.
   * Undefined unless `customerAccount` is enabled, and while prerendering.
   */
  customerSession?: CustomerSession;
  /**
   * Customer Account API client for this request. Query it with an access token from
   * `customerSession.getOrRefreshAccessToken()`. Undefined unless `customerAccount` is enabled,
   * and while prerendering.
   */
  customerAccount?: CustomerAccountClient;
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
  /** True when Oxygen sends any non-empty `oxygen-buyer-is-eu-country` value. */
  isEuCountry: boolean;
  /** From `oxygen-buyer-shop-id`. Undocumented but sent on every request; MiniOxygen sends `development`. */
  shopId?: string;
  /** From `oxygen-buyer-storefront-id`. Undocumented; MiniOxygen sends `development`. */
  storefrontId?: string;
  /** From `oxygen-buyer-deployment-id`. Undocumented; MiniOxygen sends `local`. */
  deploymentId?: string;
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
   * @default an encrypted cookie session (`createCookieSessionManager`) when `SESSION_SECRET` is
   * set, otherwise an in-memory, per-request session
   */
  sessionManager?: (args: HydrogenRequestArgs) => HydrogenSessionManager | Promise<HydrogenSessionManager>;

  /**
   * Shopify Customer Account login: serves `/account/login`, `/account/authorize`,
   * `/account/refresh` and `POST /account/logout`, and sets `Astro.locals.customerSession` and
   * `Astro.locals.customerAccount`. Needs `SHOP_ID`, `PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID` and
   * `SESSION_SECRET` (run `shopify hydrogen env pull`), and an HTTPS origin.
   * @default false
   */
  customerAccount?: boolean | CustomerAccountOptions;

  /**
   * Hydrogen route handler groups served before Astro routing. Pass a function to extend the
   * defaults instead of replacing them; it receives them as `defaults`.
   * @default cart (`/api/cart`) and predictive search (`/api/predictive-search`) handlers, plus
   * the customer account handlers when `customerAccount` is enabled
   */
  handlers?:
    | readonly ShopifyRouteHandlerGroup[]
    | ((
        args: HydrogenRequestArgs & { defaults: readonly ShopifyRouteHandlerGroup[] },
      ) => readonly ShopifyRouteHandlerGroup[] | Promise<readonly ShopifyRouteHandlerGroup[]>);

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

/** Options for the `customerAccount` config. */
export interface CustomerAccountOptions {
  /**
   * Keep the cart's buyer identity in step with the signed-in customer, so checkout is logged in.
   * @default true
   */
  cartSync?: boolean;
  /** Where to send the customer after sign-in when the login request has no `return_to`. @default '/' */
  defaultPostLoginRedirectPathname?: string;
  /** Same-origin path to redirect to when sign-in fails. @default '/account?login=failed' */
  loginFailedRedirectPath?: string;
  /** Where to send the customer after logout. @default '/' */
  postLogoutRedirectUri?: string;
  /** The storefront's public HTTPS origin, or a function of the request. @default the request origin */
  origin?: string | ((request: Request) => string);
}

/** Type helper for `src/hydrogen.config.ts`. */
export function defineHydrogenConfig(config: HydrogenConfig): HydrogenConfig {
  return config;
}
