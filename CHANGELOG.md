# Changelog

All notable changes to `astro-hydrogen` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [0.1.0] - Unreleased

First release.

### Added

- Astro adapter for Shopify Oxygen. `astro build` produces `dist/client` (assets and prerendered pages) and `dist/server/index.js`, a single self-contained module Worker, plus `oxygen.json` with the compatibility date. `shopify hydrogen deploy --worker-dir dist/server --assets-dir dist/client` deploys it.
- `astro dev` and `astro preview` run server code in MiniOxygen (workerd). Preview serves the client assets on a simulated Oxygen CDN. `.env*` files stand in for Oxygen's environment variables, and the `miniOxygen` option adds bindings, an inspector port and debug logging.
- Hydrogen middleware, injected before your own, that puts a request-scoped Storefront API client on `Astro.locals.storefront`. It picks a `private`, `private_no_buyer_context` or `public` client from the environment and the request, passes `storefrontId`, wires Oxygen's Cache API and `waitUntil` for sub-request caching, and falls back to the tokenless mock.shop store (with a warning) when `PUBLIC_STORE_DOMAIN` is unset.
- Hydrogen route handling before Astro routing: `/api/cart`, `/api/predictive-search`, the Storefront API proxy, `/checkout`, cart permalinks, `/.well-known/ucp` and `?variant=` redirects. Store redirects, `/admin` and standard route redirects run when Astro responds with a 404. Both can be turned off.
- `Astro.locals`: `storefront`, `shopifyRequestContext`, `oxygen` (`env`, `waitUntil`, `cache`), `buyer`, `shopifySession`, and, with Customer Account login, `customerSession` and `customerAccount`. Types are injected automatically.
- `Astro.locals.buyer`: country, region, region code, city, postal code, continent, latitude, longitude, time zone, metro code, `isEuCountry`, IP, and the shop, storefront and deployment IDs, from Oxygen's `oxygen-buyer-*` headers. `Astro.clientAddress` comes from `oxygen-buyer-ip`.
- Optional `src/hydrogen.config.ts` (`defineHydrogenConfig`): `i18n` (object or function), `getBuyerIp`, `storefront`, `sessionManager`, `customerAccount`, `handlers` (array, or function that extends the defaults), `routeTemplates`, `shopifyRoutes` and `shopifyRedirects`.
- Encrypted cookie session for Hydrogen's handlers, used when `SESSION_SECRET` is set: AES-GCM with a key derived from the secret, `HttpOnly`, `SameSite=Lax`, `__Host-` prefixed over HTTPS, 30 days. A tampered or expired cookie reads as an empty session. `createCookieSessionManager` is exported from `astro-hydrogen/runtime/cookie-session`.
- Customer Account login with `customerAccount: true` or an options object: `/account/login`, `/account/authorize`, `/account/refresh` and `POST /account/logout`, with cart buyer-identity sync. Requests behind an HTTPS-terminating proxy or tunnel that sends `x-forwarded-proto: https` use the public HTTPS origin.
- `<ShopifyScripts />` component (`astro-hydrogen/components/ShopifyScripts.astro`) for Shopify analytics, the Customer Privacy API and consent banner, and Perf Kit, including page views after `<ClientRouter />` navigations.
- Server components: `<Money />` (localized prices and ranges for the request's market), `<ShopifyImage />` (Shopify CDN images with `width`, `height`, `crop` and `srcset`), `<ShopPayButton />` (Hydrogen's server-rendered Shop Pay button, which needs no script) and `<PredictiveSearchForm />` (a no-JavaScript search form). Helpers: `shopifyImageUrl`, `shopifyImageSrcSet` and `isShopifyImageHost` from `astro-hydrogen/runtime/image`, and `resolveLocale` and `formatPrice` from `astro-hydrogen/runtime/money`.
- `<CartForm />`: a cart form for Hydrogen's `/api/cart` route (add, set, increase, decrease, remove, discount, note, attributes) that works without JavaScript, with optional enhancement through Shopify's Standard Actions. `<ProductForm />`: a server-rendered variant picker (option links with `?Option=Value` URLs, existence and availability from the encoded variant fields) plus an add-to-cart form, with optional in-place selection through Hydrogen's product form store. Helpers: `PRODUCT_FORM_FRAGMENT`, `getProductFormState` and `productSelectionSearch` from `astro-hydrogen/runtime/product`.
- Framework-free browser modules: `astro-hydrogen/client/cart` (`getCartStore`, `connectCart`, `onCart`, `setCartFormHandler`, `CART_SUBMIT_EVENT`) and `astro-hydrogen/client/product-form`.
- Prerendered pages and the `base` option. On Oxygen the Worker serves prerendered pages from the asset CDN at extensionless URLs. `shopify hydrogen deploy` sets `HYDROGEN_ASSET_BASE_URL`, which the adapter uses as `build.assetsPrefix`.
- A prerendered `404.astro` works alongside Hydrogen routes and redirects, in the build and in `astro dev`.
- Static `node:*` imports in the Worker fail the build with the list of offending modules. Dynamic `import('node:…')` fallbacks in dependencies become rejected promises. A `process` shim, installed before any dependency loads in both `astro dev` and the production bundle, covers dependencies that read `process.env` at load time.
- With the default Sharp image service, on-demand pages use Astro's passthrough service, since Sharp cannot run in a Worker. On Astro 7.4+, prerendered pages keep Sharp at build time.
- `Oxygen-Cache-Control` is removed from responses that Hydrogen marks private or `no-store`, so personalized pages never enter Oxygen's full-page cache.
- `Astro.locals.customerAccount` is created on first access, so pages that never read it keep working on a non-HTTPS host.
- `astro add astro-hydrogen` works: when only `integrations: [hydrogen()]` is configured, the integration registers itself as the adapter.
- Content collections for the Shopify catalog, from `astro-hydrogen/content`: `shopifyLoader` (build time, `src/content.config.ts`) and `shopifyLiveLoader` (request time, `src/live.config.ts`) for products, collections, pages and articles, or any paginated Storefront query. Entries include `rendered` HTML for `render()`; `shopifySchemas` types them; live results carry a `cacheHint` (`tags`, `lastModified`, `maxAge`, `swr`) and use the Worker's sub-request cache with the strategy you pass. `shopifyCacheOptions` turns a strategy into `Astro.cache.set()` options. Catalog data only.
- `oxygenCache()` from `astro-hydrogen/cache`: an Astro route-cache provider (`cache.provider`) backed by Oxygen's Cache API, with stale-while-revalidate emulation through `waitUntil` and best-effort tag and path invalidation. Cookie-setting and private responses are never cached.
- In `astro dev`, a single copy of `@shopify/hydrogen` is loaded for the server, and the CommonJS packages that Astro and React need are pre-bundled for workerd.

### Fixed

These corrections were made while preparing the first release.

- Prerendered pages are served correctly under a `base` path, in the Worker, in `astro preview`, and when the Worker falls back to its own origin for assets.
- `isEuCountry` is `true` for any non-empty `oxygen-buyer-is-eu-country` value, as Oxygen documents it, and `false` when the header is absent or empty.
- The server directory contains only `index.js`, its source map if any, and `oxygen.json`. Chunks that were inlined into the Worker, or that tree-shaking left unreferenced, are removed because Oxygen uploads only the entry file. This also works when the server directory is reached through a symlink.
- With a prerendered `404.astro`, URLs that match no route no longer skip Hydrogen: `/api/cart`, `/checkout`, `/admin` and store redirects work in the deployed Worker and in `astro dev`, and the 404 page is still served for everything else.
- A dependency that reads `process.env` or `process.platform` while its module loads no longer crashes the production Worker.

### Known limitations

- No Node.js APIs in the Worker, a 10 MB Worker size limit, no KV or Durable Objects, and `Astro.session` has no driver until you configure an HTTP-reachable store.
- Local images are not resized at runtime.
- Customer Account login needs an HTTPS origin, so local development needs `localHttps` or a tunnel.
- Astro fonts, i18n domains and UI frameworks other than Preact, Solid, Svelte, React and Vue are untested.
