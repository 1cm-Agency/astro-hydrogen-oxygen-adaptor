# Integration fixtures

Small Astro projects that the tests in `test/integration/` build and run in the real Workers runtime
(MiniOxygen/workerd). Run them with `npm run test:integration` from `packages/astro-hydrogen` or the
repo root (it compiles the adapter first).

Each fixture has a `package.json` (`{ "private": true, "type": "module" }`), an `astro.config.mjs` that
imports `astro-hydrogen`, `src/pages/`, and optionally `src/hydrogen.config.ts`. There is no per-fixture
install: `astro`, `@shopify/hydrogen` and the `astro-hydrogen` workspace link resolve from the monorepo's
root `node_modules`. Build output goes to `dist/<mode>-<pid>/` (gitignored, removed when the test process
exits).

| Fixture | Covers |
| --- | --- |
| `minimal` | SSR locals, buyer headers, prerendered page, API route, 404 page, user middleware, Hydrogen routes, node: fallbacks; also used by the `dev` and `pack` tests |
| `base-path` | `base: '/shop'` with static output, in the Worker and through `preview()` |
| `hydrogen-config` | every `src/hydrogen.config.ts` hook |
| `customer-account` | `customerAccount: true` login, logout and session errors |
| `features` | Actions, `astro:env`, `Astro.session`, a Preact island, i18n routing |
| `islands` | Solid and Svelte islands (`client:load`, `client:idle`, `client:visible`, `client:only`) on an on-demand page and a prerendered page, in the Worker and under `astro dev`; island modules served from the CDN |
| `node-import` | a static `node:` import must fail the build |
| `shopify-scripts` | `<ShopifyScripts />` |
| `elements` | `<Money />`, `<ShopifyImage />`, `<ShopPayButton />` and `<PredictiveSearchForm />`, with an `/en-ca` market, a prerendered page and the Shop Pay link through the Hydrogen routes |
| `cart-elements` | `<ProductForm />`, `<CartForm />`, a cart page and bare forms against mock.shop (`slides`); the no-JavaScript add, set and remove flow |
| `content` | `shopifyLoader` (products, pages, articles; `<Content />` in a prerendered page) and `shopifyLiveLoader` (collection, entry, `cacheHint`, market filter, unknown handle, sub-request cache hit) against mock.shop; also type-checks with `astro check` |
| `route-cache` | `cache: { provider: oxygenCache() }`: hit, stale-while-revalidate, tag invalidation, and a cookie page that is never cached, in MiniOxygen's Cache API |
| `prerendered-404` | a prerendered `404.astro` next to Hydrogen routes: the Worker entry still serves `/api/cart` and `/admin`, in the build and under `astro dev` |
| `integrations-only` | the config `astro add` writes (`integrations: [hydrogen()]`, no `adapter`) |

## Writing a test

```js
import { buildFixture } from '../helpers/fixture.js';

const site = await buildFixture('minimal', { cdn: true, env: { SESSION_SECRET: '...' } });
const res = await site.fetch('/api/cart', { headers: { 'oxygen-buyer-ip': '203.0.113.9' } });
await site.dispose();
```

- `cdn: true` bakes `HYDROGEN_ASSET_BASE_URL` into the build and serves the client directory from a
  simulated Oxygen CDN, as `shopify hydrogen deploy` does. Without it the Worker cannot find prerendered
  pages (MiniOxygen has no origin asset server).
- `env` becomes the Worker's bindings. Use it instead of a `.env` file: `.env` files are gitignored, so
  they would not be committed with the fixture.
- `site.logs` and `await site.waitForLog(/regex/)` expose the Worker's console output, which is kept out of
  the test report.
- `buildOnly(name)` runs just the build and rejects with the build error. `pathOf(name)` and `freePort()`
  (a free port in 4480-4499) support `dev()` and `preview()` tests.

## Adding a fixture

1. Create `test/fixtures/<name>/` with the files above.
2. Add `test/integration/<name>.test.js`; keep it independent of the other test files, which run in
   parallel processes.
3. Prefer pages that do not query Shopify. The tokenless mock.shop store is the default and needs network.
