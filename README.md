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
| `shopifySession` | The session Hydrogen route handlers use. Undefined while prerendering. |
| `oxygen` | `{ env, cache, waitUntil }` from the Oxygen Worker. Undefined while prerendering. |

The client type depends on what's available:

- **`private`**: you have `PRIVATE_STOREFRONT_API_TOKEN` and Oxygen's `oxygen-buyer-ip` header.
- **`private_no_buyer_context`**: you have the private token and the page is prerendered.
- **`public`**: everything else. It runs tokenless when `PUBLIC_STOREFRONT_API_TOKEN` is unset.

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

  // Replaces the default cart + predictive search handler groups.
  handlers: [createCartServerHandlers()],

  // Required for Customer Account handlers: a persistent, cookie-backed session.
  // sessionManager: ({ request, env }) => createMySession(request, env.SESSION_SECRET),

  // Full control over the client (pass `cache` and `waitUntil` for sub-request caching).
  // storefront: ({ requestContext, env, cache, waitUntil }) => createStorefrontClient({ ... }),
});
```

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
- **Node APIs**: The Worker targets Oxygen's Workers runtime, so dependencies must be Web-compatible.

## License

MIT
