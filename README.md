# astro-hydrogen

An [Astro](https://astro.build) adapter for Shopify. It deploys your site to [Oxygen](https://shopify.dev/docs/storefronts/headless/hydrogen/deployments) and wires [Hydrogen](https://www.npmjs.com/package/@shopify/hydrogen) into every request. It is to Oxygen what `@astrojs/cloudflare` is to Workers.

- **No UI framework required.** Pages are plain `.astro` files, and carts are plain HTML forms. React, Vue, Svelte, or none: islands are up to you.
- **The same runtime everywhere.** `astro dev` and `astro preview` run your server code in MiniOxygen (workerd), so what works locally works on Oxygen.
- **A Storefront client on every request.** `Astro.locals.storefront` is created per request, with Oxygen's cache, buyer IP and environment already wired in.
- **Shopify routes built in.** Cart and predictive search endpoints, the Storefront API proxy, `/checkout`, cart permalinks, `/.well-known/ucp`, `/admin`, and store URL redirects all work with no code.

## Install

```sh
npx astro add astro-hydrogen
```

or by hand:

```sh
npm install astro-hydrogen @shopify/hydrogen
```

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import hydrogen from 'astro-hydrogen';

export default defineConfig({
  output: 'server',
  adapter: hydrogen(),
});
```

That's it. Without any environment variables it uses the tokenless [mock.shop](https://mock.shop) demo store. To use your own store, link it with the Shopify CLI and pull its variables:

```sh
npx shopify hydrogen link
npx shopify hydrogen env pull   # writes PUBLIC_STORE_DOMAIN, tokens, SESSION_SECRET to .env
```

## Usage

```astro
---
// src/pages/products/[handle].astro
import { Cache, gql } from '@shopify/hydrogen';

const PRODUCT_QUERY = gql(`
  query Product($handle: String!, $country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    product(handle: $handle) {
      title
      variants(first: 10) { nodes { id title } }
    }
  }
`);

const { data } = await Astro.locals.storefront.graphql(PRODUCT_QUERY, {
  variables: { handle: Astro.params.handle! },
  cache: Cache.short(), // sub-request cache, backed by Oxygen's Cache API
});
if (!data?.product) return new Response(null, { status: 404 });
---

<h1>{data.product.title}</h1>

<!-- Works without JavaScript: Hydrogen's cart handler sets the cart cookie and redirects back. -->
<form method="post" action="/api/cart">
  <select name="merchandiseId">
    {data.product.variants.nodes.map((v) => <option value={v.id}>{v.title}</option>)}
  </select>
  <input type="hidden" name="quantity" value="1" />
  <button name="intent" value="add">Add to cart</button>
</form>
```

Hydrogen fills in `$country` and `$language` from the request's market. Results are fully typed from the query string, with no codegen. For editor autocompletion, add `{ "name": "@shopify/hydrogen/ts-plugin" }` to `compilerOptions.plugins` in your `tsconfig.json`.

### What's on `Astro.locals`

| Key | What it is |
| --- | --- |
| `storefront` | The request-scoped Storefront API client. |
| `shopifyRequestContext` | Hydrogen's request context: `i18n`, cookies, and response headers. |
| `shopifySession` | The session Hydrogen route handlers use: an encrypted cookie session when `SESSION_SECRET` is set. Undefined while prerendering. |
| `customerSession` | Hydrogen's `CustomerSession` (`isLoggedIn`, `getOrRefreshAccessToken`, ...). Only with `customerAccount` enabled; undefined while prerendering. |
| `customerAccount` | A Customer Account API client for the request. Only with `customerAccount` enabled; undefined while prerendering. |
| `oxygen` | `{ env, cache, waitUntil }` from the Oxygen Worker. Undefined while prerendering. |
| `buyer` | The buyer's location from Oxygen's headers: `country`, `region`, `regionCode`, `city`, `postalCode`, `continent`, `latitude`, `longitude`, `timezone`, `metroCode`, `isEuCountry` and `ip`. Undefined while prerendering. |

The client type depends on what's available:

- **`private`**: you have `PRIVATE_STOREFRONT_API_TOKEN` and Oxygen's `oxygen-buyer-ip` header.
- **`private_no_buyer_context`**: you have the private token and the page is prerendered.
- **`public`**: everything else. It runs tokenless when `PUBLIC_STOREFRONT_API_TOKEN` is unset.

### Analytics, consent and Perf Kit

Render `<ShopifyScripts />` once in your layout's `<head>`:

```astro
---
import ShopifyScripts from 'astro-hydrogen/components/ShopifyScripts.astro';
---
<head>
  <ShopifyScripts consent={{ mode: 'default-banner' }} />
</head>
```

It loads Shopify's analytics, the Customer Privacy API (with Shopify's banner when you choose `default-banner`) and Perf Kit, then starts them in the browser. Hydrogen emits a page view event on load and after each `<ClientRouter />` navigation; Astro doesn't re-run Shopify's head scripts when it swaps pages. The consent request goes through the adapter's Storefront API proxy, which sets Shopify's `_shopify_essential`, `_shopify_analytics` and `_shopify_marketing` cookies.

The shop comes from `SHOP_ID`, `PUBLIC_STOREFRONT_ID` and `PUBLIC_STORE_DOMAIN` (all set by `shopify hydrogen env pull`), and the market from your `i18n` config. Props:

| Prop | |
| --- | --- |
| `consent` | `{ mode: 'no-banner' \| 'default-banner' \| 'custom-banner' }`. Defaults to `no-banner`. |
| `shop`, `i18n` | Override the env values or the market. Pass `i18n={{ currency: 'USD' }}` so analytics knows the currency. |
| `account`, `inbox` | Load the `shopify-account` and `shopify-chat` components. |
| `shopifyAnalytics`, `analytics`, `debug`, `nonce`, `webMcp` | Passed through to Hydrogen. |
| `initialize` | Set `false` to call `initializeShopifyScripts()` yourself, for example to pass a `custom-banner` `setup` callback, which can't be serialized from the server. |

Without a shop ID, as with mock.shop, it renders nothing and logs one warning. Publish product, collection and cart events from your own scripts through `window.Shopify.analytics` (see Hydrogen's `AnalyticsEvent`).

### Buyer location

```astro
{Astro.locals.buyer?.postalCode && <p>Delivery estimate for {Astro.locals.buyer.postalCode}</p>}
```

On Oxygen these values come from Shopify's edge. Locally, MiniOxygen fills them with San Francisco defaults. A page that reads `buyer` must be server-rendered, because a prerendered page has no buyer.

### Prerendered pages

`export const prerender = true` works as usual. Prerendered pages get a buyer-less client and an in-memory cache, and their environment comes from your `.env`. On Oxygen, the HTML is uploaded with your other assets to Shopify's CDN, and the Worker serves it at the page URL.

### Routes the adapter handles

Before Astro routing, the adapter runs [`handleShopifyRoutes`](https://www.npmjs.com/package/@shopify/hydrogen). It serves:

- `/api/cart` (JSON or form posts)
- `/api/predictive-search`
- `/api/{version}/graphql.json`
- `/checkout`
- `/cart/{variant}:{qty}` permalinks
- `/.well-known/ucp`
- `?variant=` product URLs

When Astro responds with a 404, it runs `handleShopifyRedirects`. That covers `/admin`, the store's URL redirects, and standard route redirects.

## Configuration

### Adapter options

```js
hydrogen({
  middleware: true,         // set false to wire Hydrogen yourself
  configFile: 'src/hydrogen.config.ts', // default: auto-detected
  cacheName: 'hydrogen',    // caches.open() name
  compatibilityDate: '2026-04-01', // written to oxygen.json
  miniOxygen: { env: {}, inspectorPort: 9229, debug: false }, // dev/preview; env is merged over .env
});
```

### Runtime config: `src/hydrogen.config.ts`

This optional file controls per-request behaviour. Each hook receives `{ request, url, env, runtime, isPrerendered }`.

```ts
import { createCartServerHandlers, createShopifyRouteTemplates } from '@shopify/hydrogen';
import { defineHydrogenConfig } from 'astro-hydrogen/config';

export default defineHydrogenConfig({
  // Markets: derive the locale from the URL or headers.
  i18n: ({ url }) =>
    url.pathname.startsWith('/en-ca')
      ? { country: 'CA', language: 'EN', pathPrefix: '/en-ca' }
      : { country: 'US', language: 'EN' },

  // Only if you serve Shopify resources at non-standard paths.
  routeTemplates: createShopifyRouteTemplates({ product: '/p/:productHandle' }),

  // Replaces the default cart + predictive search handler groups. Pass a function to extend
  // them: handlers: ({ defaults }) => [...defaults, myHandlers],
  handlers: [createCartServerHandlers()],

  // Customer Account login (see below).
  // customerAccount: true,

  // Replaces the default session (an encrypted cookie when SESSION_SECRET is set).
  // sessionManager: ({ request, env }) => createMySession(request, env.SESSION_SECRET),

  // Full control over the client (pass `cache` and `waitUntil` for sub-request caching).
  // storefront: ({ requestContext, env, cache, waitUntil }) => createStorefrontClient({ ... }),
});
```

### Sessions and Customer Account login

Hydrogen ships no persistent session, so the adapter does. When `SESSION_SECRET` is set (Oxygen injects it; `shopify hydrogen env pull` writes it locally), `Astro.locals.shopifySession` is stored in one cookie, `__Host-session` over HTTPS and `session` over plain HTTP. The cookie is HttpOnly, `SameSite=Lax`, and encrypted and authenticated with AES-GCM (key derived from `SESSION_SECRET`), because it holds customer tokens. A tampered, expired or wrongly keyed cookie reads as an empty session. Keep it under about 4 KB; the adapter warns once if it grows past that. Without `SESSION_SECRET` the session lasts one request. This is separate from `Astro.session`. For other behaviour, `createCookieSessionManager` is exported from `astro-hydrogen/runtime/cookie-session`.

Enable login with one option:

```ts
export default defineHydrogenConfig({ customerAccount: true });
```

This serves `/account/login`, `/account/authorize`, `/account/refresh` and `POST /account/logout` (log out with a `<form method="post" action="/account/logout">`), and keeps the cart's buyer identity in sync. Pass `{ cartSync: false, defaultPostLoginRedirectPathname, loginFailedRedirectPath, postLogoutRedirectUri, origin }` to tune it. It needs `SHOP_ID`, `PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID` and `SESSION_SECRET`; a request fails with an error naming any that is missing (run `shopify hydrogen env pull`). Shopify's OAuth requires a public HTTPS origin, so locally use a tunnel and register its callback URL (`https://<tunnel>/account/authorize`) in the Customer Account API settings. Link to the routes with plain `<a>` or `<form>`.

```astro
---
const { customerSession, customerAccount, shopifySession, shopifyRequestContext } = Astro.locals;
const token = await customerSession?.getOrRefreshAccessToken(shopifySession, shopifyRequestContext);
---
{token ? <form method="post" action="/account/logout"><button>Log out</button></form> : <a href="/account/login">Log in</a>}
```

Calling `getOrRefreshAccessToken` may rewrite tokens; the middleware commits the session cookie for framework-rendered responses, but streamed responses that have already started cannot set it.

If you set `handlers` to an array, the adapter's defaults (including the customer account routes) are not added; use the function form, `handlers: ({ defaults }) => [...defaults, mine]`, to keep them.

## Deploy to Oxygen

```sh
npm install -D @shopify/cli
npx shopify hydrogen deploy --worker-dir dist/server --assets-dir dist/client
```

The deploy command runs your `build` script with `HYDROGEN_ASSET_BASE_URL` set. The adapter uses that value as Astro's `build.assetsPrefix`, so bundled assets load from Shopify's CDN, and bakes it into the Worker so prerendered pages can be fetched from there. The build produces:

```text
dist/
├── client/          # uploaded to Oxygen's asset CDN
└── server/
    ├── index.js     # one self-contained module Worker
    └── oxygen.json  # compatibility date
```

## Notes

- **Images**: Sharp can't run in a Worker, so the default image service becomes the passthrough service. Request resized Shopify images from the Storefront API instead: `url(transform: { maxWidth: 400 })`.
- **Astro sessions** have no driver configured by default. Configure `session.driver` yourself if you need it.
- **Node APIs**: Oxygen runs Workers with no Node.js compatibility, so dependencies must be Web-compatible. The build fails with a list of offenders if the Worker imports a `node:*` module statically. Dynamic `import('node:…')` fallbacks, like the one in `@astrojs/react`, are turned into rejected promises.
- **UI frameworks**: Framework islands work as usual. In dev, CommonJS server dependencies must be pre-bundled for workerd; React is handled for you, and ESM-only frameworks such as Preact need nothing. Add others to `vite.environments.ssr.optimizeDeps.include`.
- **Raw buyer headers**: The parsed `locals.buyer` covers the documented headers. The raw `oxygen-buyer-*` headers are still on `Astro.request.headers`.

## License

MIT
