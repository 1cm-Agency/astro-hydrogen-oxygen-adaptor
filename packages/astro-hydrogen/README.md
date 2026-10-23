# astro-hydrogen

Deploy an [Astro](https://astro.build) storefront straight to [Shopify Oxygen](https://shopify.dev/docs/storefronts/headless/hydrogen/deployments), the hosting that comes with your store. [Hydrogen](https://www.npmjs.com/package/@shopify/hydrogen) handles the commerce primitives; you write plain `.astro` pages and add islands in whatever framework you like, or none.

The adapter builds your site into the single module Worker Oxygen runs, and wires Hydrogen into every request: a Storefront API client scoped to the buyer, Hydrogen's cart, search, checkout and redirect handlers, an encrypted cookie session, and optional Customer Account login. `astro dev` and `astro preview` run your server code in MiniOxygen (workerd), the same runtime as Oxygen, so local and production behave the same.

This is the full reference. For a quicker tour, start with the [repository README](https://github.com/1cm-Agency/astro-hydrogen-oxygen-adaptor#readme).

**Compared with `@astrojs/cloudflare`.** Both produce a Worker. Oxygen is a more restricted Worker platform: no Node.js compatibility, no KV or Durable Objects, only environment variables and the Cache API. It is deployed with the Shopify CLI, not Wrangler. This adapter bundles the Worker for those limits, reads Shopify's `oxygen-buyer-*` headers, and adds Hydrogen. It does not use Cloudflare bindings.

**Compared with Hydrogen's React Router template.** The template is a React Router app. This package lets you write a storefront with Astro (plain `.astro` pages, islands in any framework you like) while using the same Hydrogen SDK underneath. It depends on `@shopify/hydrogen`, not on React Router. It is not a migration path for the template's components or routes.

## Requirements

| | |
| --- | --- |
| Node.js | `^22.12 \|\| ^24` |
| `astro` | `^7.0.0` |
| `@shopify/hydrogen` | `>=2026.10.0` |

## Quick start

One command sets up a project:

```sh
npm create astro-hydrogen@latest my-shop
```

In an empty or new directory it creates a complete storefront that runs against the mock.shop demo store with no configuration: product listing, product page with variant picker, cart, search and a prerendered page, built with the components below and no UI framework (the same code as [`examples/mock-shop`](https://github.com/1cm-Agency/astro-hydrogen-oxygen-adaptor/tree/main/examples/mock-shop)). Run it in an existing Astro project instead (`npm create astro-hydrogen@latest .`) and it installs the dependencies, sets `output: 'server'` and `adapter: hydrogen()` in your Astro config, adds the `deploy` script, and adds a working product page and cart page without overwriting anything. It also works with `pnpm create`, `yarn create` and `bun create`.

To do the same by hand:

```sh
npm install astro-hydrogen @shopify/hydrogen
npm install -D @shopify/cli
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

```json
// package.json (scripts)
{
  "dev": "astro dev",
  "build": "astro build",
  "preview": "astro preview",
  "deploy": "shopify hydrogen deploy --worker-dir dist/server --assets-dir dist/client"
}
```

Without environment variables the adapter uses the tokenless [mock.shop](https://mock.shop) demo store and logs one warning. To use your own store, link it and pull its variables into `.env`:

```sh
npx shopify hydrogen link
npx shopify hydrogen env pull
```

A first page:

```astro
---
// src/pages/index.astro
import { gql } from '@shopify/hydrogen';

const { data } = await Astro.locals.storefront.graphql(
  gql(`query Products { products(first: 4) { nodes { id title handle } } }`),
);
---

<ul>
  {data?.products.nodes.map((p) => <li><a href={`/products/${p.handle}`}>{p.title}</a></li>)}
</ul>
```

A product page with a cached query and a cart form that works without JavaScript:

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
  cache: Cache.short(),
});
if (!data?.product) return new Response(null, { status: 404 });
---

<h1>{data.product.title}</h1>

<form method="post" action="/api/cart">
  <select name="merchandiseId">
    {data.product.variants.nodes.map((v) => <option value={v.id}>{v.title}</option>)}
  </select>
  <input type="hidden" name="quantity" value="1" />
  <button name="intent" value="add">Add to cart</button>
</form>
```

Hydrogen fills `$country` and `$language` from the request's market. Results are typed from the query string without codegen. For editor autocompletion add `{ "name": "@shopify/hydrogen/ts-plugin" }` to `compilerOptions.plugins` in `tsconfig.json`, and run `npx hydrogen gql check` to validate `gql` documents (for example in your `typecheck` script).

| Command | What it does |
| --- | --- |
| `npm run dev` | `astro dev` in MiniOxygen. Shell environment variables are not passed to the Worker; only `.env*` files and `miniOxygen.env` are. |
| `npm run build` | Builds `dist/client` and `dist/server/index.js`. |
| `npm run preview` | Serves the build in MiniOxygen with the client assets on a simulated Oxygen CDN. |
| `npm run deploy` | Builds with Oxygen's asset URL and uploads. See [Deploy to Oxygen](#deploy-to-oxygen-and-ci). |

> **`astro add astro-hydrogen`** installs the package and `@shopify/hydrogen`, but because the package is an Astro integration it writes `integrations: [hydrogen()]` and does not set `output` or `adapter`. That still works: when no adapter is configured the integration registers itself as the adapter and logs a one-line notice. Move it to `adapter: hydrogen()` and add `output: 'server'` if you want server rendering by default (otherwise pages are prerendered unless they export `prerender = false`).

## How requests flow

```text
Oxygen -> Worker (dist/server/index.js)
  1. x-forwarded-proto: https on an http: request upgrades the URL to https:
  2. env, waitUntil and caches.open('hydrogen') become Astro.locals.oxygen
  3. URL is a prerendered page? -> fetch its HTML from the asset CDN and return it (middleware does not run)
  4. No route matches and 404.astro is prerendered? -> run Hydrogen routes and redirects here (see below)
  5. Astro renders, running the adapter's middleware first:
       build the request context and Storefront client      -> Astro.locals
       handleShopifyRoutes()   matched? respond
       next()                  your middleware, then the page
       status 404?             handleShopifyRedirects()
       commit the session cookie and apply Hydrogen's response headers
```

Hydrogen routes run before Astro routing, so they win over an Astro page at the same path (for example `/api/cart`).

**Prerendered 404.** When `src/pages/404.astro` is prerendered, Astro answers URLs that match no route from the static file and skips middleware. The Worker therefore runs `handleShopifyRoutes` and then `handleShopifyRedirects` itself for those URLs, so `/api/cart`, `/checkout`, `/admin` and store redirects keep working. This happens only when the adapter's `middleware` option is on, and your own `src/middleware.ts` does not run for those URLs. It also applies in `astro dev`.

Every response that goes through the middleware gets `powered-by: Shopify, Hydrogen`. If the response sets a cookie, or a Customer Account call was made during the request, Hydrogen sets `Cache-Control: private, no-store, max-age=0, must-revalidate` and removes `CDN-Cache-Control` and `Surrogate-Control`.

### Routes Hydrogen serves

`handleShopifyRoutes` serves these before Astro routing (the exact set depends on your `@shopify/hydrogen` version):

- `/api/cart` (JSON or form posts) and `/api/predictive-search`
- `/api/{version}/graphql.json`, the Storefront API proxy (also used by consent and analytics)
- `/checkout` and `/cart/{variant}:{qty}` permalinks
- `/.well-known/ucp`
- `?variant=<id>` on product URLs
- `/account/login`, `/account/authorize`, `/account/refresh`, `POST /account/logout` when [`customerAccount`](#customer-accounts) is on

`handleShopifyRedirects` runs when Astro responds with 404: `/admin`, redirects between Shopify's standard paths and your `routeTemplates`, same-origin `return_to` and `redirect` query parameters, and the store's URL redirects.

## `Astro.locals`

Types are injected into `.astro/types.d.ts`, so `Astro.locals` is typed with no setup.

| Key | Type | Notes |
| --- | --- | --- |
| `storefront` | `HydrogenStorefrontClient` | Request-scoped Storefront API client. Queries accept `cache`. Available on prerendered pages too. |
| `shopifyRequestContext` | `ShopifyRequestContext` | Hydrogen's request context: `i18n`, cookies, buyer IP, response header handling. Available on prerendered pages. |
| `oxygen` | `{ env, waitUntil, cache }` | The Worker's environment bindings, `waitUntil`, and the `caches.open(cacheName)` store (`undefined` if the Cache API is unavailable). Undefined while prerendering. |
| `buyer` | `OxygenBuyer` | Location and identity from `oxygen-buyer-*` headers. Undefined while prerendering. |
| `shopifySession` | `HydrogenSessionManager` | The session Hydrogen's handlers use. See [Sessions](#sessions). Undefined while prerendering. |
| `customerSession` | `CustomerSession` | `isLoggedIn`, `getAccessToken`, `getOrRefreshAccessToken`, `logout`. Only with `customerAccount` on; undefined while prerendering. |
| `customerAccount` | `CustomerAccountClient` | Customer Account API client for the request. Only with `customerAccount` on; undefined while prerendering. |

`Astro.clientAddress` is the first IP in `oxygen-buyer-ip`, when it looks like an IP address.

`OxygenBuyer` fields. A field is absent when Oxygen sends no value for it:

| Field | Header | Notes |
| --- | --- | --- |
| `ip` | from `getBuyerIp` (default `oxygen-buyer-ip`) | First value of a comma-separated list, if it looks like an IPv4 or IPv6 address. |
| `country`, `region`, `regionCode`, `city`, `postalCode`, `continent`, `timezone`, `metroCode` | `oxygen-buyer-<name>` | Strings. `country` is ISO 3166-1 alpha-2. |
| `latitude`, `longitude` | `oxygen-buyer-latitude`, `oxygen-buyer-longitude` | Numbers. |
| `isEuCountry` | `oxygen-buyer-is-eu-country` | Always present. `true` for any non-empty value, as Oxygen documents it; `false` when absent or empty. |
| `shopId`, `storefrontId`, `deploymentId` | `oxygen-buyer-shop-id`, `-storefront-id`, `-deployment-id` | Not documented by Shopify but sent on every request. MiniOxygen sends `development`, `development` and `local`. |

Locally, MiniOxygen fills the location headers with San Francisco defaults and the IP with `127.0.0.1`. A page that reads `buyer` must be server-rendered. The raw headers remain on `Astro.request.headers`.

```astro
{Astro.locals.buyer?.isEuCountry && <p>Cookie notice for EU visitors.</p>}
```

## Storefront client selection

With no `storefront` hook, the adapter creates the client from the Worker's environment:

| Condition | Client `type` |
| --- | --- |
| `PRIVATE_STOREFRONT_API_TOKEN` is set and the request has a buyer IP | `private` |
| `PRIVATE_STOREFRONT_API_TOKEN` is set and the page is being prerendered | `private_no_buyer_context` |
| otherwise | `public`, using `PUBLIC_STOREFRONT_API_TOKEN`, or tokenless when it is unset |

- The store is `PUBLIC_STORE_DOMAIN`. When it is unset the client uses `mock.shop` and logs a warning once.
- `PUBLIC_STOREFRONT_ID` is passed as `storefrontId`.
- Empty strings count as unset.
- Every client gets `cache` (Oxygen's Cache API store, or an in-memory cache while prerendering) and `waitUntil`, so `cache: Cache.short()` works on queries.
- The client has a `type` property you can read to see which one you got.

## Configuration

### Adapter options

```js
hydrogen({
  middleware: true,
  configFile: 'src/hydrogen.config.ts',
  cacheName: 'hydrogen',
  compatibilityDate: '2026-04-01',
  miniOxygen: { env: {}, inspectorPort: 9229, debug: false },
});
```

| Option | Default | |
| --- | --- | --- |
| `middleware` | `true` | Inject the Hydrogen middleware (`order: 'pre'`, so it runs before your `src/middleware.ts`). Set `false` to wire Hydrogen yourself; `locals.oxygen` is still set, but `storefront`, `buyer`, sessions and Shopify routes are not. |
| `configFile` | first existing of `src/hydrogen.config.{ts,mts,js,mjs}` | Path to the [runtime config](#runtime-config-srchydrogenconfigts), relative to the project root. The build fails with `[astro-hydrogen] configFile not found: <path>` if a path you give does not exist. |
| `cacheName` | `'hydrogen'` | Name passed to `caches.open()` for sub-request caching. |
| `compatibilityDate` | `'2026-04-01'` | Workers compatibility date, written to `oxygen.json` and used by MiniOxygen. |
| `miniOxygen.env` | `{}` | Extra bindings for `astro dev` and `astro preview`, merged over the `.env*` files; these win. |
| `miniOxygen.inspectorPort` | MiniOxygen's default | Port for the Worker inspector (Chrome DevTools). |
| `miniOxygen.debug` | off | MiniOxygen debug logging. |

Beyond those options, the adapter also changes your Astro config:

- `build.serverEntry` is `index.js`.
- During `shopify hydrogen deploy`, `build.assetsPrefix` becomes the deployment's CDN URL, unless you set one.
- If the image service is Sharp (the default), on-demand pages get Astro's passthrough service, because Sharp cannot run in a Worker. On Astro 7.4+, where the service is split into `build` and `runtime`, prerendered pages keep Sharp at build time. Any other service you configure is left alone. In dev, Astro's image endpoint is replaced with the generic one, which uses `fetch` instead of `node:fs`.
- The `ssr` environment resolves with the `worker`, `workerd`, `module` and `browser` conditions and bundles every dependency.
- After the build, the Worker is flattened into one `index.js`, everything else in `dist/server` is deleted, and `oxygen.json` is written.
- The adapter declares `buildOutput: 'server'`, because Oxygen always runs a Worker, even if every page is prerendered.

### Runtime config: `src/hydrogen.config.ts`

An optional module whose default export controls per-request behaviour. Hooks receive `{ request, url, env, runtime, isPrerendered }`. `runtime` is `undefined` and `env` comes from `process.env` while prerendering.

```ts
import { createShopifyRouteHandler, createShopifyRouteTemplates } from '@shopify/hydrogen';
import { defineHydrogenConfig } from 'astro-hydrogen/config';

const ping = {
  ping: createShopifyRouteHandler('/api/ping', 'GET', async () => ({ type: 'json', data: { ok: true } })),
};

export default defineHydrogenConfig({
  i18n: ({ url }) =>
    url.pathname === '/en-ca' || url.pathname.startsWith('/en-ca/')
      ? { country: 'CA', language: 'EN', pathPrefix: '/en-ca' }
      : { country: 'US', language: 'EN' },
  routeTemplates: createShopifyRouteTemplates({ product: '/p/:productHandle' }),
  handlers: ({ defaults }) => [...defaults, ping],
});
```

| Hook | Default | |
| --- | --- | --- |
| `i18n` | `{ country: 'US', language: 'EN' }` | An `I18nConfig`, or a function of the request args returning one (may be async). A `pathPrefix` tells Hydrogen which path prefix the locale uses. Astro does not strip it, so create the pages under that prefix yourself (for example `src/pages/en-ca/`). |
| `getBuyerIp` | the `oxygen-buyer-ip` header, validated | `(args) => string \| undefined`. Called only for server-rendered requests. Its result is the `private` client's buyer IP and `locals.buyer.ip`. |
| `storefront` | the [default client](#storefront-client-selection) | `(args) => client`. Args add `requestContext`, `buyerIp`, `cache` and `waitUntil`; pass `cache` and `waitUntil` to your client config to keep sub-request caching. |
| `sessionManager` | encrypted cookie when `SESSION_SECRET` is set, else per-request in-memory | `(args) => HydrogenSessionManager`. See [Sessions](#sessions). |
| `customerAccount` | `false` | `true`, or `{ cartSync, defaultPostLoginRedirectPathname, loginFailedRedirectPath, postLogoutRedirectUri, origin }`. See [Customer accounts](#customer-accounts). |
| `handlers` | cart + predictive search (+ customer account when enabled) | An array, which **replaces** the defaults, or a function `({ ...args, defaults }) => groups` to extend them. |
| `routeTemplates` | `{}` (Shopify's standard paths) | Your non-standard resource paths, shared by route handling, redirects and `<ShopifyScripts />`. |
| `shopifyRoutes` | `true` | `false` skips `handleShopifyRoutes` (and the Shopify routes in the prerendered-404 path). |
| `shopifyRedirects` | `true` | `false` skips `handleShopifyRedirects` after a 404. |

While prerendering, only `i18n`, `storefront` and the shared setup run; there is no buyer, session or handlers.

## Sessions

There are two unrelated session systems.

### `Astro.locals.shopifySession`

This is what Hydrogen's route handlers use. Oxygen has no server-side storage, so by default the adapter keeps the session in a single encrypted cookie when `SESSION_SECRET` is set (Oxygen injects it; `shopify hydrogen env pull` writes it locally). Without the secret the session lasts one request, which is enough for the cart and predictive search handlers (they use cookies of their own) but not for Customer Account login.

- **Stores:** whatever Hydrogen's handlers put there: the customer's access, refresh and ID tokens, and the pending sign-in state. The cart ID lives in Hydrogen's `cart` cookie, not here.
- **Cookie:** `__Host-session` over HTTPS, `session` over plain HTTP. `Path=/`, `Max-Age=2592000` (30 days), `HttpOnly`, `SameSite=Lax` (`Strict` would drop the session on the redirect back from Shopify), plus `Secure` on HTTPS.
- **Encryption:** AES-GCM (256-bit key derived from `SESSION_SECRET` with HKDF-SHA256) over a JSON payload with an expiry. The cookie name is authenticated, so a value cannot be replayed under another name. The browser can neither read nor modify the contents.
- **Failure mode:** a missing, tampered, expired or wrongly keyed cookie reads as an empty session; nothing throws. Rotating `SESSION_SECRET` signs everyone out.
- **Writes:** `Set-Cookie` is sent only when the session changed. An emptied session expires the cookie, if the browser sent one.
- **Size:** browsers drop cookies over about 4096 bytes. The adapter logs one warning when a cookie would be larger. Keep the session small.
- **Streaming:** the cookie is committed when the response is returned. A streamed response that has already started cannot set it.

To change the cookie or replace the whole mechanism:

```ts
import { createCookieSessionManager } from 'astro-hydrogen/runtime/cookie-session';

export default defineHydrogenConfig({
  sessionManager: ({ request, env }) =>
    createCookieSessionManager({
      request,
      secret: env.SESSION_SECRET!,
      cookie: { name: 'my-session', maxAge: 60 * 60 * 24 * 7 }, // also: sameSite, secure, path
    }),
});
```

Any object with `getSessionOrigin`, `getSessionItem`, `setSessionItem`, `removeSessionItem` and an optional `commit()` returning headers to append works. A custom `sessionManager` also removes the `SESSION_SECRET` requirement of `customerAccount`.

### `Astro.session`

Astro's own session API has no default driver on Oxygen, and `Astro.session` is `undefined` until you configure one. The Worker Cache API is not a session store: it is per data center and entries can be evicted. Oxygen offers no KV, so use a store the Worker can reach over HTTP, such as Upstash:

```js
// astro.config.mjs
import { defineConfig, sessionDrivers } from 'astro/config';

export default defineConfig({
  session: {
    driver: sessionDrivers.upstash({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    }),
  },
});
```

Install the driver's SDK (`npm install @upstash/redis`); without it the build fails with `"Redis" is not exported by "__vite-optional-peer-dep:@upstash/redis:unstorage"`. Add the two variables to the storefront's environment variables on Oxygen. This setup has not been exercised against a live Upstash database.

## Customer accounts

Enable Shopify's Customer Account login with one line:

```ts
// src/hydrogen.config.ts
import { defineHydrogenConfig } from 'astro-hydrogen/config';

export default defineHydrogenConfig({ customerAccount: true });
```

**Environment variables**, all written by `shopify hydrogen env pull` and injected by Oxygen for a linked storefront:

| Variable | |
| --- | --- |
| `SHOP_ID` | Numeric shop ID. |
| `PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID` | OAuth client ID. |
| `SESSION_SECRET` | Encrypts the session cookie. Not needed if you provide `sessionManager`. |
| `PUBLIC_CUSTOMER_ACCOUNT_API_URL` | Optional. Base URL of Shopify's OAuth endpoints; defaults to `https://shopify.com/authentication/{SHOP_ID}`. Must be HTTPS. |

A request that finds one missing fails with an error naming it. Astro turns the error into an empty 500 response; the message is in the Worker's logs.

**Routes** (served before Astro routing): `GET /account/login` (accepts `return_to`), `GET /account/authorize` (the OAuth callback), `GET /account/refresh` (accepts `return_to`, defaults to `/account`) and `POST /account/logout`. The logout route returns 403 unless the `Origin` or `Referer` matches your origin, and 405 for GET. Link to these with plain `<a>` and `<form>`: the handlers return raw redirects to Shopify that client-side routing cannot follow.

**Options:**

| Option | Default | |
| --- | --- | --- |
| `cartSync` | `true` | Attach the signed-in customer to the cart on sign-in and refresh, and detach on logout, so checkout is logged in. |
| `defaultPostLoginRedirectPathname` | `'/'` | Where to go after sign-in when the login request has no same-origin `return_to`. |
| `loginFailedRedirectPath` | `'/account?login=failed'` | Same-origin path to go to when sign-in fails. |
| `postLogoutRedirectUri` | `'/'` | Where to go after logout. A same-origin `return_to` on the logout request overrides it. |
| `origin` | the request origin | The storefront's public HTTPS origin, or a function of the request. |

If you set `handlers` to an array, the customer account routes are not added; use the function form to keep them.

**An account page.** Hydrogen ships no account UI, so you own it. Read the login state with `isLoggedIn`, and refresh the access token only where the response can commit cookies, as a page can:

```astro
---
// src/pages/account/index.astro (must be server-rendered)
import { gql } from '@shopify/hydrogen/customer-account';

const { customerSession, customerAccount, shopifySession, shopifyRequestContext } = Astro.locals;

if (!(await customerSession!.isLoggedIn(shopifySession!, shopifyRequestContext))) {
  return Astro.redirect('/account/login?return_to=/account');
}

const accessToken = await customerSession!.getOrRefreshAccessToken(shopifySession!, shopifyRequestContext);
if (!accessToken) return Astro.redirect('/account/login?return_to=/account');

const { data, errors } = await customerAccount!.graphql(
  gql(`query { customer { firstName lastName emailAddress { emailAddress } } }`),
  { accessToken },
);
---

<h1>Hello {data?.customer?.firstName}</h1>
<form method="post" action="/account/logout"><button>Log out</button></form>
```

A logged-out visitor is redirected to `/account/login?return_to=/account`. Check `errors` before rendering. For a header link that only needs to know whether someone is signed in, call `isLoggedIn` alone: it does not refresh tokens. `getOrRefreshAccessToken` may rewrite the session, and the middleware commits the cookie for rendered responses, but a streamed response that has already started cannot set it. Never put tokens or session objects in HTML.

**Local development.** Shopify's OAuth needs a public HTTPS origin. With `customerAccount` on, `/account/login` over plain `http://localhost` fails with `Customer Account OAuth origin must use HTTPS`; on any other non-HTTPS host, reading `Astro.locals.customerAccount` fails with `Customer Account API origin must use HTTPS` (the client is created on first access, so pages that don't touch it keep working). Two options:

1. **Hydrogen's local HTTPS** (`local.tryhydrogen.dev`, which resolves to `127.0.0.1`). Provision certificates once with `npx hydrogen certs install`, then add the plugin and host to `astro.config.mjs`, as in Hydrogen's local HTTPS guide:

   ```js
   import { LOCAL_HTTPS_DEFAULTS, localHttps } from '@shopify/hydrogen/vite';

   const enabled = process.env.npm_lifecycle_event === 'dev:https';

   export default defineConfig({
     // ...
     server: enabled ? { host: LOCAL_HTTPS_DEFAULTS.host, port: LOCAL_HTTPS_DEFAULTS.port } : undefined,
     vite: { plugins: [localHttps({ enabled })] },
   });
   ```

   and add `"dev:https": "astro dev"` to your scripts. The plugin can also push the callback URLs to Shopify through the Shopify CLI. This package's tests do not run Astro under that plugin.

2. **A tunnel.** Run `astro dev` behind an HTTPS tunnel that forwards `x-forwarded-proto: https`. The Worker upgrades an `http:` request carrying that header to `https:`. Add the tunnel's hostname to `server.allowedHosts` in `astro.config.mjs`, or Astro rejects the request with a 403.

Register the callback in the storefront's Customer Account API settings in the Hydrogen or Headless channel: `https://<host>/account/authorize` as the callback URI, the origin (no port) as the JavaScript origin, and `https://<host>` as the logout URI. The `origin` option can fix the origin if a proxy hides it.

## Caching

- **Storefront queries.** Pass `cache: Cache.short()`, `Cache.long()`, `Cache.none()` or `Cache({ ... })` per query. `short` is 1 s fresh plus 9 s stale-while-revalidate; `long` is 1 h plus 23 h. Nothing is cached unless you pass a strategy, and mutations are never cached. Revalidation runs in `waitUntil`.
- **Third-party APIs.** Use `createRunWithCache` with the Worker's cache:

  ```astro
  ---
  import { Cache, createRunWithCache } from '@shopify/hydrogen';

  const { oxygen } = Astro.locals;
  const runWithCache = createRunWithCache({ cache: oxygen!.cache!, waitUntil: oxygen!.waitUntil });

  const { data, cacheStatus } = await runWithCache(
    { key: ['reviews', Astro.params.handle], strategy: Cache.short() },
    async () => {
      const res = await fetch(`https://reviews.example.com/${Astro.params.handle}`);
      return { data: await res.json(), shouldCache: res.ok };
    },
  );
  ---
  ```

  `locals.oxygen` is undefined while prerendering, so skip the cache there.
- **Never cache personalized data** (cart, customer) with a shared key. Hydrogen's sub-request cache is for catalog reads. For buyer-specific data use `createRunWithCache` with an explicit key that includes the buyer.
- **Where the cache lives.** Oxygen has only the Cache API through `caches.open()`; `caches.default` is unsupported. The cache is per data center.
- **Prerendering.** There is no Worker cache at build time. Queries with a `cache` strategy use an in-memory cache for the build process, which also dedupes identical queries across pages.
- **Full-page caching.** Oxygen caches public GET responses that carry an `Oxygen-Cache-Control` header:

  ```astro
  ---
  Astro.response.headers.set('Oxygen-Cache-Control', 'public, max-age=60');
  ---
  ```

  The adapter removes it from any response Hydrogen marks private or `no-store` (personalized queries, customer data, consent), and Hydrogen itself removes `CDN-Cache-Control` and `Surrogate-Control`. Still, do not set it on pages that depend on cookies, the session, or `buyer`, since those are not detected automatically.

### Route caching

`oxygenCache()` is an Astro [route cache](https://docs.astro.build/en/guides/caching/) provider backed by Oxygen's Cache API (`caches.open()`), so `Astro.cache.set()` and `routeRules` cache whole rendered responses in the Worker's data center:

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import hydrogen from 'astro-hydrogen';
import { oxygenCache } from 'astro-hydrogen/cache';

export default defineConfig({
  adapter: hydrogen(),
  cache: { provider: oxygenCache() }, // options: { cacheName: 'astro-routes', keyPrefix?: string }
  routeRules: { '/blog/[...path]': { maxAge: 300, swr: 60, tags: ['blog'] } },
});
```

```astro
---
Astro.cache.set({ maxAge: 60, swr: 300, tags: ['product-123'] });
---
```

```js
// an API route or middleware
await cache.invalidate({ tags: 'product-123' }); // or { path: '/products/123' }
```

- **What is cached:** GET responses with status 200 and a `maxAge`. Responses that set a cookie, send `Cache-Control: private` or `no-store`, or `Vary: Cookie` are never cached. Pages that depend on the visitor's session must not be given a `maxAge`. The cache key is the path plus the sorted query string; tracking parameters such as `utm_*` are ignored.
- **Stale-while-revalidate is emulated.** The Cache API has no SWR, so each entry records when it was stored. Within `swr` seconds after `maxAge`, the stale page is served and a refresh is scheduled with `waitUntil`.
- **Tags are best-effort.** Invalidation writes a marker per tag (and per path) that is checked on each lookup. The Oxygen cache is per data center and entries can be evicted, so an invalidation only takes effect in the data center that handled it; treat tags as a freshness hint, not a guarantee. Entries are kept at most 7 days.
- **Environments:** works on Oxygen, in MiniOxygen and in `astro preview`. It does nothing in `astro dev` (Astro disables route caching there) or while prerendering in Node (one warning, requests pass through).
- **With live collections:** pass a live collection's `cacheHint` plus `shopifyCacheOptions(strategy)` to `Astro.cache.set()` (see [Content collections](#content-collections)) so the rendered page and the data it came from expire together.

## Analytics and consent

Render `<ShopifyScripts />` once in the `<head>` of your layout:

```astro
---
import ShopifyScripts from 'astro-hydrogen/components/ShopifyScripts.astro';
---
<head>
  <ShopifyScripts consent={{ mode: 'default-banner' }} />
</head>
```

It loads Shopify's analytics, the Customer Privacy API (with Shopify's banner for `default-banner`) and Perf Kit, and starts them in the browser. Page views are sent on load and after each `<ClientRouter />` navigation. Consent requests go through the Storefront API proxy route, which sets Shopify's `_shopify_essential`, `_shopify_analytics` and `_shopify_marketing` cookies.

The shop comes from `SHOP_ID`, `PUBLIC_STOREFRONT_ID` (falling back to `'0'`) and `PUBLIC_STORE_DOMAIN`; the market from your `i18n` config.

| Prop | |
| --- | --- |
| `consent` | `{ mode: 'no-banner' \| 'default-banner' \| 'custom-banner' }`. Default `no-banner`. |
| `shop`, `i18n` | Override the env values or the market. Pass `i18n={{ currency: 'USD' }}` so analytics knows the currency. |
| `account`, `inbox` | Load the `shopify-account` and `shopify-chat` components. |
| `shopifyAnalytics`, `analytics`, `debug`, `nonce` | Passed through to Hydrogen. |
| `webMcp` | Load Shopify's WebMCP tools in supporting browsers. Default `true`. |
| `initialize` | `false` to call `initializeShopifyScripts()` yourself, for example to pass a `custom-banner` `setup` callback, which cannot be serialized from the server. |

Without a shop ID or store domain (as with mock.shop) it renders nothing and logs one warning. Send product, collection and cart events from your own scripts through `window.Shopify.analytics`.

## Components

Server components that ship as `.astro` source and import the helpers below. They need no client JavaScript. Import them from `astro-hydrogen/components/*.astro`.

### `<Money />`

A price formatted for the request's market (`en-CA` under `/en-ca`). The locale comes from `Astro.locals.shopifyRequestContext.i18n`, and falls back to `en-US` when the middleware is disabled. It also works in prerendered pages.

```astro
---
import Money from 'astro-hydrogen/components/Money.astro';
---
<Money money={product.priceRange.minVariantPrice} />
<Money range={[min, max]} withoutTrailingZeros as="strong" class="price" />
```

| Prop | |
| --- | --- |
| `money` | A `MoneyV2` (`{ amount, currencyCode }`). |
| `range` | `[min, max]`, both `MoneyV2` in one currency, instead of `money`. |
| `locale` | BCP 47 locale. Default: the request's market. |
| `withoutTrailingZeros` | `$19` instead of `$19.00`. |
| `withoutCurrency` | Leave out the currency symbol. |
| `as` | The element to render. Default `span`. |

Other attributes are passed to the element. It renders `data-currency` and `data-amount` (`data-amount-min` and `data-amount-max` for a range). For custom layouts, call Hydrogen's `formatMoney()` with `resolveLocale()` from `astro-hydrogen/runtime/money` and use its `parts`.

### `<ShopifyImage />`

An `<img>` for a Shopify CDN image. It sets `width`, `height` and `crop` as URL parameters and, with `widths`, a `srcset`.

```astro
<ShopifyImage src={image.url} alt={image.altText ?? product.title} width={400} widths={[400, 800]} sizes="(min-width: 768px) 25vw, 50vw" />
```

| Prop | |
| --- | --- |
| `src` | The image URL. |
| `alt` | Required. Use `""` for a decorative image. |
| `width` | Display width in pixels. Sizes `src`. |
| `height` | Display height in pixels. With `width` it fixes the aspect ratio: `srcset` candidates are scaled to it, so a `320`×`320` image yields `640`×`640`, not `640`×`320`. |
| `widths` | Candidate widths for `srcset`. |
| `sizes` | The `sizes` attribute. Only rendered with `widths`. |
| `crop` | `top`, `center`, `bottom`, `left` or `right`. |
| `loading`, `decoding` | Default `lazy` and `async`. Use `loading="eager"` for the image above the fold. |

Only `cdn.shopify.com`, `mock.shop` and their subdomains are rewritten. Other URLs render as given, without a `srcset`. Other attributes are passed to the `<img>`.

### `<ShopPayButton />`

Hydrogen's Shop Pay button, rendered on the server as `<hydrogen-shop-pay-button>` with a declarative shadow root. It works before any JavaScript loads, and the page needs no script for it.

```astro
<ShopPayButton variants={[{ id: variant.id, quantity: 1 }]} width="100%" disabled={!variant.availableForSale} />
```

The props are Hydrogen's `ShopPayButtonOptions`: `variants` (variant IDs or `{ id, quantity }`; omit them to check out the current cart), `disabled`, `width`, `borderRadius`, `accessibilityLabel`, `channel`, `checkoutUrl` and `nonce`. Without `checkoutUrl` the button links to your own `/cart/{variant}:{qty}` or `/checkout`. The adapter's [Hydrogen routes](#routes-hydrogen-serves) redirect those to the store's checkout, so leave them enabled.

### `<PredictiveSearchForm />`

A `role="search"` GET form with an input named `q`, using Hydrogen's form attributes, so search works without JavaScript. It is server-only: it does not include Hydrogen's predictive search client store, and the results page is yours.

```astro
<PredictiveSearchForm placeholder="Search">
  <button type="submit">Search</button>
</PredictiveSearchForm>
```

| Prop | |
| --- | --- |
| `action` | The search page path. Default `/search`. |
| `placeholder` | Placeholder for the input. |
| `label` | The input's `aria-label`. Default `Search`. |
| `value` | Initial value. Default: the `q` parameter of the current URL. |
| `inputAttrs` | Attributes for the `<input>`, such as `id` or `class`. |

The default slot is rendered after the input. Other attributes are passed to the `<form>`. The `/api/predictive-search` route that Hydrogen serves is what a client-side autocomplete would call.

### `<CartForm />` and `<ProductForm />`

`<CartForm />` posts to Hydrogen's `/api/cart` route. It is plain HTML, so it works without JavaScript and on stores without Shopify's scripts (such as mock.shop): the route sets the `cart` cookie and redirects back.

```astro
---
import CartForm from 'astro-hydrogen/components/CartForm.astro';
---
<CartForm action="add" merchandiseId={variant.id} quantity={1} label="Add to cart" />
<CartForm action="set" lineId={line.id} quantity={line.quantity}>
  <button name="intent" value="remove">Remove</button>
</CartForm>
```

| Prop | |
| --- | --- |
| `action` | `add`, `set`, `increase`, `decrease`, `remove`, `discount-apply`, `discount-remove`, `note-update` or `attributes-update`. |
| `merchandiseId`, `quantity`, `sellingPlanId`, `attributes` | For `add`. Hydrogen's route takes one line per form post. |
| `lineId`, `quantity` | For the line actions. `set` renders an editable quantity input. |
| `discountCode`, `note` | For the discount and note actions. |
| `endpoint` | The post URL. Defaults to `/api/cart`. |
| `label` | The default submit button's text. The default slot replaces that button. |
| `enhance` | Defaults to `true`: marks the form `data-cart-form` and loads `astro-hydrogen/client/cart`. When Shopify's Standard Actions are on the page (`<ShopifyScripts />` with a `SHOP_ID`) the cart updates without a page load; otherwise the form posts normally. `false` renders no script. |

`<ProductForm />` renders a variant picker and an add-to-cart form. Query the product with the fragment it needs:

```astro
---
import ProductForm from 'astro-hydrogen/components/ProductForm.astro';
import { PRODUCT_FORM_FRAGMENT } from 'astro-hydrogen/runtime/product';

const query = `query Product($handle: String!, $selectedOptions: [SelectedOptionInput!]!) {
  product(handle: $handle) { ...ProductFormFields }
} ${PRODUCT_FORM_FRAGMENT}`;
---
<ProductForm product={data.product} />
```

Option values are links (`?Color=Red&Size=M`), so selection works without JavaScript; with `enhance` (the default) they switch in place through Hydrogen's product form store and keep the URL in sync. Props: `product`, `searchParams` (defaults to the current URL's), `locale` for the price, `enhance`, and a `price` slot. Style it through the `data-*` hooks: `data-option`, `data-option-value`, `data-selected`, `data-sold-out`, `data-product-price`, `data-product-submit`. `getProductFormState(product, searchParams)` from `astro-hydrogen/runtime/product` gives the same resolved state for custom markup.

For your own cart UI, use the browser module:

```ts
import { connectCart, onCart } from 'astro-hydrogen/client/cart';
connectCart();
const stop = onCart((cart) => render(cart));
```

`connectCart()` is idempotent and also wires every `data-cart-form` on the page. `CART_SUBMIT_EVENT` fires on `document` when the store takes over a form, which is the moment to open a cart drawer.

### Helpers

`astro-hydrogen/runtime/image` exports `shopifyImageUrl(url, { width, height, crop })`, `shopifyImageSrcSet(url, { widths, width, height, crop })` (`height` and `crop` apply only with `width`, which gives the ratio to scale each candidate by) and `isShopifyImageHost(hostname)`. `astro-hydrogen/runtime/money` exports `resolveLocale(i18n)`, which turns `{ language: 'EN', country: 'CA' }` into `en-CA`, and `formatPrice(money | [min, max], { locale?, i18n?, ...formatMoneyOptions })`, which returns the localized string. Use them where a component does not fit, such as `og:image` URLs or client islands.

## Content collections

`astro-hydrogen/content` has two loaders that read the Shopify catalog (products, collections, pages and blog articles) through Astro's content layer. Both use a buyer-less Storefront client, so they never see a cart or a customer: **they are for catalog data only.** Do not point them at personalized queries.

| | `shopifyLoader` | `shopifyLiveLoader` |
| --- | --- | --- |
| Config file | `src/content.config.ts` | `src/live.config.ts` |
| Runs | at build time (and `astro sync`), into the content store | on every `getLiveCollection()` / `getLiveEntry()` call |
| Read with | `getCollection()`, `getEntry()`, `render()` | `getLiveCollection()`, `getLiveEntry()` |
| Freshness | as of the last build | as fresh as the cache strategy allows |
| Pages | prerendered or on demand | on-demand only (live collections need on-demand rendering) |
| Caching | none: the store is the cache | Hydrogen sub-request cache with the strategy you pass |

Use the build-time loader for content that changes rarely (pages, articles, a small catalog) and you want in static pages, with `render()` and `<Content />`. Use the live loader for catalogs that change often or are too big to load at build time.

```ts
// src/content.config.ts
import { defineCollection } from 'astro:content';
import { shopifyLoader } from 'astro-hydrogen/content';

export const collections = {
  products: defineCollection({ loader: shopifyLoader({ resource: 'products', query: 'tag:featured', max: 200 }) }),
  pages: defineCollection({ loader: shopifyLoader({ resource: 'pages' }) }),
};
```

```ts
// src/live.config.ts
import { defineLiveCollection } from 'astro:content';
import { Cache } from '@shopify/hydrogen';
import { shopifyLiveLoader } from 'astro-hydrogen/content';

export const collections = {
  liveProducts: defineLiveCollection({ loader: shopifyLiveLoader({ resource: 'products', cache: Cache.long() }) }),
};
```

```astro
---
import { getLiveCollection, getLiveEntry } from 'astro:content';
import { Cache } from '@shopify/hydrogen';
import { shopifyCacheOptions } from 'astro-hydrogen/content';

const { entries, error, cacheHint } = await getLiveCollection('liveProducts', { first: 12, query: 'tag:sale' });
const { entry } = await getLiveEntry('liveProducts', { handle: Astro.params.handle });
if (!entry) return new Response(null, { status: 404 });

// Tags and lastModified come from the hint; the window comes from the loader's strategy.
if (Astro.cache?.enabled) Astro.cache.set({ ...cacheHint, ...shopifyCacheOptions(Cache.long()) });
---
```

Entry IDs are handles (`slides`), or `blog-handle/article-handle` for articles, so `getEntry('products', 'slides')` works. The full Storefront object is in `entry.data` (including its global `id`), and `entry.rendered.html` holds the description (products, collections), body (pages) or content (articles), which is what `render()` outputs. Rendered HTML comes from Shopify and is not sanitized.

### `shopifyLoader` options

| Option | Default | |
| --- | --- | --- |
| `resource` | | `'products'`, `'collections'`, `'pages'` or `'articles'`. |
| `query` | | Storefront search syntax, e.g. `tag:sale AND available_for_sale:true`. |
| `sortKey`, `reverse` | | Sorting; `sortKey` is the resource's Storefront sort key, e.g. `TITLE`. |
| `first` | `50` | Page size per Storefront request (the API allows up to 250). |
| `max` | `Infinity` | Stop after this many entries. |
| `i18n` | `hydrogen.config.ts` `i18n` if it is an object, else `{ country: 'US', language: 'EN' }` | The market for prices and translations. |

For anything else, pass `{ query, variables?, entries, first?, max?, i18n? }` instead of `resource`. `query` takes `$first` and `$after` and selects `pageInfo { hasNextPage endCursor }`; `entries(data)` returns `{ id, data, body?, rendered? }[]` for each page. `$country` and `$language` are filled in when the query declares them. Entries that disappear from Shopify are removed from the store on the next load, and the loader logs a progress line.

With a `resource`, the loader supplies a loose (`passthrough`) Zod schema, so `getCollection()` is typed and extra fields survive. A `schema` in `defineCollection` replaces it; start from `shopifySchemas.products.extend({ ... })` to keep the rest.

### `shopifyLiveLoader` options

| Option | Default | |
| --- | --- | --- |
| `resource` | | As above. |
| `cache` | `Cache.short()` | The sub-request cache strategy for every query. `Cache.none()` skips the cache. |
| `first` | `20` | Default page size. |
| `i18n` | as above | Default market. |

Generic form: `{ query, variables?, entries, entry?, entryQuery?, cache?, i18n? }`. Filter keys are passed to the query as variables. `entry(data)` picks the entry from a `loadEntry` response (default: the first of `entries(data)`).

Filters:

- `getLiveCollection(name, { query?, first?, after?, sortKey?, reverse?, country?, language? })`. The loader gets no request, so the market comes from `i18n`, and `country` / `language` override it per call, e.g. from `Astro.currentLocale` or `Astro.locals.buyer`.
- `getLiveEntry(name, { id } | { handle })`, plus the same `country` / `language`. `id` is the entry ID or a global ID (`gid://shopify/Product/1`). An unknown handle gives no entry: `getLiveEntry` returns a `LiveEntryNotFoundError` in `error`, so you decide the status.

Results carry `cacheHint: { tags, lastModified, maxAge, swr }`. Tags are `shopify:<resource>` plus each entry's global ID, so `Astro.cache.invalidate()` can purge by them; `lastModified` is the latest `updatedAt`. Astro keeps only `tags` and `lastModified` of a hint when it returns it, and its `Astro.cache.set()` reads `maxAge` / `swr` from options, so use `shopifyCacheOptions(strategy)` (as above) for the window. Failures (GraphQL errors, network, throttling) come back as `error`, a `ShopifyLoaderError` with the GraphQL `errors` on it.

The live loader reads the Worker's `caches.open()` store, per data center, with the strategy you pass. A loader has no request, so there is no `waitUntil`: cache writes are awaited. Outside a Worker, at build time, queries use the in-memory cache. Because the cache key is the query and its variables, different `first`, `query` or market values are cached separately.

## Prerendering, assets and `base`

`export const prerender = true` works as usual, as does `output: 'static'` with `prerender = false` on individual pages.

- **Build time.** Prerendered pages run through the middleware with `isPrerendered` set: a buyer-less client (`private_no_buyer_context` with a private token, else `public`), an in-memory cache, and an environment taken from `process.env`, which includes your `.env*` files. In CI, provide the store variables to the build step or prerendered pages are built against mock.shop. Do not read `Astro.clientAddress`, `Astro.request.headers` or `locals.buyer` there.
- **On Oxygen.** `dist/client` (HTML, JS, CSS, images, `public/`) is uploaded to Oxygen's asset CDN, which serves files that have an extension. The Worker handles extensionless page URLs: for a GET or HEAD to a prerendered page it fetches `…/index.html` (or `.html`) from the CDN and returns it with status 200. The middleware does not run for these requests, so they carry no per-request headers, cookies or personalization.
- **Deploy-time URL.** `shopify hydrogen deploy` sets `HYDROGEN_ASSET_BASE_URL` for the build. The adapter uses it as `build.assetsPrefix` and bakes it into the Worker. A `dist/` built for one deployment must not be uploaded as another.
- **Without a CDN URL** (a plain `astro build` served by something other than Oxygen), the Worker requests prerendered pages from its own origin under `base`. `astro preview` provides that origin. A bare MiniOxygen does not, so prerendered pages 404 there.
- **`base`.** `base: '/shop'` is supported: prerendered pages are served at `/shop/` and `/shop`, on-demand pages under `/shop/...`, and unknown paths 404. This is covered by tests in the Worker and through `astro preview`. On Oxygen's CDN the client directory is the root, so the prefix is not part of the CDN path.
- **Images.** Sharp cannot run in a Worker, so on-demand pages use the passthrough service: `<Image>` and `getImage()` do not resize or convert local images at runtime. Prerendered pages keep Sharp at build time on Astro 7.4+. Request resized Shopify images from the Storefront API with `url(transform: { maxWidth: 400 })` (or the CDN's URL parameters). Astro's experimental fonts are untested.

## Deploy to Oxygen and CI

```sh
npx shopify hydrogen deploy --worker-dir dist/server --assets-dir dist/client
```

With those flags the command builds your project (`node --run build`, so you need a `build` script) with `HYDROGEN_ASSET_BASE_URL` set to the deployment's asset URL, then uploads. The build produces:

```text
dist/
├── client/          # uploaded to Oxygen's asset CDN
└── server/
    ├── index.js     # one self-contained module Worker
    └── oxygen.json  # { "version": 1, "compatibility_date": "..." }
```

Oxygen uploads only `index.js`, its source map and `oxygen.json` from the worker directory, and limits the Worker to 10 MB. The adapter deletes any other file in `dist/server` (inlined chunks) so what you see is what ships.

**Environment variables.** For a linked storefront Oxygen injects these into the Worker:

| Variable | Source |
| --- | --- |
| `PUBLIC_STORE_DOMAIN`, `PUBLIC_STOREFRONT_ID`, `PUBLIC_STOREFRONT_API_TOKEN`, `PRIVATE_STOREFRONT_API_TOKEN`, `PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID`, `PUBLIC_CUSTOMER_ACCOUNT_API_URL`, `SHOP_ID`, `SESSION_SECRET` | Automatic. `shopify hydrogen env pull` writes the same values to `.env`. |
| `PUBLIC_CHECKOUT_DOMAIN` | Set it yourself. |
| Anything else (CMS tokens, third-party keys) | Set in the storefront's environment variables. Read with `Astro.locals.oxygen.env`, or `astro:env` secrets. |

There is no Node.js `process` at runtime beyond a small shim that makes `process.env` an empty object. Read configuration from `Astro.locals.oxygen.env` (or `astro:env`), and fall back to `process.env` only for prerendered pages:

```ts
const env = (locals.oxygen?.env ?? process.env) as MyEnv;
```

**GitHub Actions.** Shopify adds a GitHub workflow to your repository when you link a storefront. If you write your own, deploy with the same flags, the deployment token and `--env-branch` (not `--env`, which takes an environment handle):

```yaml
name: Deploy to Oxygen
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npx shopify hydrogen deploy --worker-dir dist/server --assets-dir dist/client --env-branch ${{ github.ref_name }}
        env:
          SHOPIFY_HYDROGEN_DEPLOYMENT_TOKEN: ${{ secrets.OXYGEN_DEPLOYMENT_TOKEN }}
          # Variables that prerendered pages need at build time, for example:
          # PUBLIC_STORE_DOMAIN: ${{ vars.PUBLIC_STORE_DOMAIN }}
```

Check the flags against `npx shopify hydrogen deploy --help` for your CLI version.

Deployments are immutable: each deploy uploads new code and assets under a new asset URL. To change what a deployment serves, deploy again.

## Compatibility

| Astro feature | Status |
| --- | --- |
| On-demand rendering (`output: 'server'`) | Supported. |
| Prerendering, and hybrid (`prerender = true` or `false` per page) | Supported. |
| Middleware | Supported. The adapter's runs first; yours follows. |
| Actions | Supported (a JSON action post is covered by a test). |
| `astro:env`, including `getSecret()` | Supported. Values come from the Worker's bindings. |
| i18n routing | Supported (a locale prefix fixture is covered). |
| i18n domains | Declared `experimental`; untested. |
| View Transitions (`<ClientRouter />`) | Supported. `<ShopifyScripts />` sends page views after navigations. |
| `Astro.session` | No driver by default; see [Sessions](#sessions). |
| Images | Sharp for prerendered pages at build time (Astro 7.4+); passthrough at runtime, no resizing. Shopify CDN images are sized by URL with `<ShopifyImage />`. |
| Fonts | Untested. |
| Content collections | Supported for Shopify catalog data: build-time (`shopifyLoader`) and live (`shopifyLiveLoader`) loaders, both covered by a fixture against mock.shop; see [Content collections](#content-collections). Other loaders do not depend on the adapter. |

UI frameworks: Preact, Solid and Svelte are tested. Fixtures server-render their islands inside the Worker and under `astro dev`, with `client:load`, `client:idle`, `client:visible` and `client:only`, on both on-demand and prerendered pages, and hydration was checked in a browser against `astro preview`. The three can share one page: Solid and Svelte together add about 1 MB to the Worker. React and Vue build, and rendered in the Worker and in dev when checked by hand. Other frameworks are untested.

In `astro dev` the server runs in workerd, which loads only ES modules. CommonJS packages that your server code imports must be pre-bundled, or the request fails with `module is not defined`. The adapter already does this for `react`, `react-dom` and Astro's `picomatch`; add others:

```js
export default defineConfig({
  vite: { environments: { ssr: { optimizeDeps: { include: ['some-cjs-package'] } } } },
});
```

Production builds bundle everything and do not need this.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Build fails: `Oxygen has no Node.js built-in modules, but the Worker imports: node:fs (from …)` | Something in the server graph statically imports a `node:*` module. Oxygen has none. Replace the dependency or the code. Dynamic `import('node:…')` calls (like the fallback in `@astrojs/react`) don't fail the build; they become rejected promises with `node:… is not available on Oxygen.` |
| `ReferenceError: process is not defined` | workerd has no `process`. The adapter installs an empty `process.env` before anything else loads, in dev and in the bundle, so `process.env.X` reads are safe, but `process.platform`, `Buffer` and other Node APIs don't exist. Read config from `Astro.locals.oxygen.env`, guard with `typeof process`, or avoid the dependency. |
| `ReferenceError: module is not defined` in dev, response `An unexpected error occurred` | A CommonJS package in the server graph. See [Compatibility](#compatibility). |
| Warning: `PUBLIC_STORE_DOMAIN is not set; using the tokenless mock.shop demo store` | No `.env`. Run `npx shopify hydrogen link` and `npx shopify hydrogen env pull`, or set the variable. In dev only `.env*` files and `miniOxygen.env` reach the Worker, not your shell's environment. |
| `<ShopifyScripts />` renders nothing; warning `<ShopifyScripts /> rendered nothing: SHOP_ID and PUBLIC_STORE_DOMAIN not set` | The component needs the shop ID and domain. Pull the env, or pass the `shop` prop. |
| Empty 500 response; log says `` `customerAccount` is enabled but SESSION_SECRET is not set `` (or `SHOP_ID`, `PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID`) | Astro hides middleware errors behind an empty body; read the Worker log. Run `npx shopify hydrogen env pull`, or provide a `sessionManager` if the secret is the one missing. |
| `Customer Account OAuth origin must use HTTPS` or `Customer Account API origin must use HTTPS. Received: http://…` | Login needs a public HTTPS origin. See [Customer accounts](#customer-accounts) for local HTTPS or a tunnel. |
| Customers are signed out at random; warning `session cookie is N bytes, over the ~4096 byte browser limit` | The session grew too large. Store less in it. |
| `/api/cart`, `/checkout` or `/admin` return the 404 page | They are served by Hydrogen unless `shopifyRoutes` / `shopifyRedirects` is `false` or the `middleware` option is off. With a prerendered `404.astro` the Worker runs them itself, but only with `middleware` on. Check your `hydrogen.config.ts`. |
| Prerendered pages 404 on a bare MiniOxygen or custom host, but work on Oxygen and in `astro preview` | The Worker looks for them at `HYDROGEN_ASSET_BASE_URL`, or, if that wasn't set at build time, at its own origin under `base`. Deploy with `shopify hydrogen deploy`, which sets it, or serve `dist/client` at the Worker's origin. |
| `astro build` fails with `Named export 'parseCookie' not found` (or another export of a package you never imported) | Astro's server output imports Astro's own dependencies by name (`cookie`, `clsx`, ...), and another copy of that package is hoisted to your `node_modules`, usually by a dependency that pins an old major. The Worker bundle resolves these from Astro's package, so the deployed Worker is right either way, but Astro's prerender step imports the output in Node, which takes the hoisted copy. `npm ls cookie` shows the copies; a fresh `npm install` without the lockfile usually hoists Astro's, and an `overrides` entry in `package.json` settles it. |
| `astro dev` shows `MiniOxygen couldn't load your app's entry point` / `No Oxygen worker entry was found` | The adapter resolves outside the project root, for example a symlinked package (`npm link`, a workspace) outside Vite's allowed file list. Allow its real path: `vite: { server: { fs: { allow: ['.', realpathSync('node_modules/astro-hydrogen')] } } }` (with `import { realpathSync } from 'node:fs'`). |
| `astro dev` returns immediately and no output appears | Astro 7 runs `astro dev` and `astro preview` as background daemons when started by an AI agent. Use `astro dev status`, `astro dev logs` and `astro dev stop`. |
| Build fails: `"Redis" is not exported by "__vite-optional-peer-dep:@upstash/redis:unstorage"` | Install the session driver's SDK. See [Sessions](#sessions). |
| `[astro-hydrogen] configFile not found` | The `configFile` option points to a missing file. |

## Limitations

- No Node.js APIs in the Worker: no `node:*` imports, `Buffer`, or filesystem access.
- The Worker is limited to 10 MB.
- No KV or Durable Objects. Persistence beyond cookies means an HTTP-reachable store.
- The Cache API is per data center and `caches.default` is unsupported.
- Prerendered pages have no buyer, session or per-request headers, and they bypass middleware at request time.
- Hydrogen routes shadow Astro routes at the same path.
- Local images are not resized at runtime.
- `index.js` is a single bundle; code splitting is off.
- Customer Account login requires HTTPS, so local development needs `localHttps` or a tunnel.

## Security notes

- **Trusted headers.** The adapter takes `oxygen-buyer-*` (location, IP, shop IDs) at face value; Oxygen sets them at its edge. If the Worker can be reached without Oxygen's edge, such as a self-hosted MiniOxygen behind your own proxy, strip them at the proxy or override `getBuyerIp`, because the private Storefront client forwards the IP to Shopify. `x-forwarded-proto: https` upgrades an `http:` request URL to `https:`; it never downgrades. An internal `x-astro-hydrogen-asset` header marks the Worker's own CDN fetches; a client that sends it only skips the prerendered-page lookup and the prerendered-404 handling for its own request.
- **Session cookie.** `HttpOnly`, `SameSite=Lax`, `Secure` and `__Host-` prefixed on HTTPS, encrypted and authenticated, 30 days. Keep `SESSION_SECRET` secret and long.
- **Logout CSRF.** Hydrogen's logout route needs a same-origin `Origin` or `Referer`.
- **Personalized responses.** Responses that set cookies or use the Customer Account API get `Cache-Control: private, no-store`.
- **Secrets.** `PRIVATE_STOREFRONT_API_TOKEN` and `SESSION_SECRET` exist only in the Worker's environment. Do not expose tokens or session objects in HTML or to client islands.

## License

MIT
