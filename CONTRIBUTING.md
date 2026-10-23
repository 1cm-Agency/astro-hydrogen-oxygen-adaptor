# Contributing to astro-hydrogen

Thanks for helping. This file covers the repository layout, the development loop, how the tests work and how releases happen. The user documentation is in [packages/astro-hydrogen/README.md](packages/astro-hydrogen/README.md) and the release notes in [packages/astro-hydrogen/CHANGELOG.md](packages/astro-hydrogen/CHANGELOG.md).

Requires Node `^22.12 || ^24`. The workspace pins Astro 7 and `@shopify/hydrogen` 2026.10.

## Layout

```text
packages/astro-hydrogen/        the adapter (the published package)
  src/index.ts                    Astro integration: adapter registration, Vite config, image service,
                                  Worker bundling (astro:build:done), oxygen.json
  src/build.ts                    build helpers: virtual modules, .env loading, single-file Worker bundling
                                  (Rolldown), node: import handling, MiniOxygen dev plugins
  src/config.ts                   public types (HydrogenConfig, HydrogenLocals, OxygenEnv, ...) and defineHydrogenConfig
  src/entrypoints/server.ts       the Oxygen module Worker; also what MiniOxygen runs in `astro dev`
  src/entrypoints/middleware.ts   the injected Hydrogen middleware
  src/entrypoints/preview.ts      `astro preview` on MiniOxygen with a simulated asset CDN
  src/runtime/                    per-request logic imported by the entrypoints and by user code:
                                  hydrogen-request (shared setup), storefront (default client), cookie-session,
                                  session (per-request fallback), customer-account, buyer, client-ip,
                                  assets (prerendered page lookup), memory-cache, shopify-scripts, user-config,
                                  image, money, product, worker-runtime, oxygen-cache
  src/content/                    shopifyLoader, shopifyLiveLoader, shopifySchemas, shopifyCacheOptions
  src/cache/oxygen.ts             oxygenCache(): Astro route-cache provider on the Cache API
  src/client/                     browser modules: cart store and product form enhancement
  components/*.astro              ShopifyScripts, Money, ShopifyImage, ShopPayButton, PredictiveSearchForm,
                                  CartForm, ProductForm
  types.d.ts                      injected into .astro/ so Astro.locals is typed
  test/*.test.js                  unit tests
  test/integration/*.test.js      integration tests (build and run fixtures in workerd)
  test/fixtures/                  small Astro projects used by the integration tests (see its README)
  test/helpers/                   fixture.js (build + Worker harness), html.js
packages/create-astro-hydrogen/ `npm create astro-hydrogen`: scaffolds a new storefront from the example, or
                                adds the adapter to an existing Astro project (no dependencies, no build step)
  bin/, src/                      the CLI; src/init-files/ holds the pages added to existing projects
  scripts/sync-template.js        copies examples/mock-shop into template/ (gitignored) before tests and publish
  test/                           unit tests; test/integration/ scaffolds, installs and builds a project
examples/mock-shop/             example storefront against the mock.shop demo store: plain .astro pages,
                                the adapter's components, no UI framework; also the scaffold template
test/oxygen-worker.test.mjs     e2e: builds the example and drives the Worker in MiniOxygen
```

`packages/astro-hydrogen/dist/` is compiled TypeScript. Tests import from `dist/`, so every test script compiles first.

## Develop

```sh
npm install
npm run dev               # compile the adapter, then astro dev for examples/mock-shop (MiniOxygen)
npm run dev:adapter       # optional, second terminal: recompile the adapter on change
npm run example:build && npm run example:preview
```

The example uses the mock.shop demo store unless you give it a `.env` (see `examples/mock-shop/.env.example`). Astro 7 runs `astro dev` and `astro preview` as background daemons when an AI agent starts them; stop one with `astro dev stop`.

## Scripts

| Script (from the repo root) | What it runs |
| --- | --- |
| `npm run build` | `tsc` for the adapter. |
| `npm run dev` | Build the adapter, then `astro dev` in `examples/mock-shop`. |
| `npm run dev:adapter` | `tsc --watch` for the adapter. |
| `npm run typecheck` | `tsc --noEmit` in the package and `astro check` in the example. |
| `npm test` | Unit tests of both packages: the adapter (build, then `node --test 'test/*.test.js'`) and the scaffolder (template sync, then its offline tests). |
| `npm run test:integration` | The adapter's: build, then `node --test 'test/integration/*.test.js'`, which builds each fixture and drives it in workerd, `astro dev` and `astro preview`. The scaffolder's: create a project in a temp dir, install it with the adapter packed from this checkout, and `astro build` it. |
| `npm run test:coverage` | Unit tests with Node's coverage over `dist/`. |
| `npm run test:e2e` | Build, then `test/oxygen-worker.test.mjs`: builds the example the way `shopify hydrogen deploy` would and runs it in MiniOxygen. Needs network access to mock.shop. |
| `npm run example:dev`, `example:build`, `example:preview` | The example's own scripts. |
| `npm run ci` | What CI runs: build, typecheck, unit, integration and e2e tests. |
| `npm run release:check` | `npm pack --dry-run` for both packages, then `npm run ci`. |

In `packages/astro-hydrogen` the same names exist (`build`, `dev`, `typecheck`, `test`, `test:coverage`, `test:integration`). To run one file: `node --test test/integration/minimal.test.js` after `npm run build`. In `packages/create-astro-hydrogen`: `test`, `test:integration` and `sync-template`; to try the CLI from the checkout, `node packages/create-astro-hydrogen/bin/create-astro-hydrogen.js <dir> --no-install`.

## Request lifecycle

```text
Oxygen -> entrypoints/server.ts (module Worker)
  - x-forwarded-proto: https upgrades an http: request URL to https:
  - env, waitUntil and caches.open(cacheName) -> locals.oxygen; astro:env reads the Worker env
  - env and cache are also stored for content loaders, which run without a request (runtime/worker-runtime.ts)
  - prerendered URL?  -> fetch its HTML from the asset CDN (runtime/assets.ts), return it; no middleware
  - no route matches, `404.astro` is prerendered, middleware is on?
        -> handleUnmatchedRequest(): handleShopifyRoutes(), then handleShopifyRedirects()
           (Astro would otherwise render the static 404 page without running middleware)
  - app.render()
       -> entrypoints/middleware.ts (order: 'pre')
            prepareHydrogenRequest(): i18n, buyer IP, request context, Storefront client -> locals
            prerendered page? set storefront + context, next(), done
            else: buyer, session, customer account -> locals
            handleShopifyRoutes()         matched? respond
            next()                        your middleware, then the page
            404?  handleShopifyRedirects()
            commit session cookie, apply Hydrogen response headers, drop Oxygen-Cache-Control on private responses
```

`runtime/hydrogen-request.ts` holds the per-request setup shared by the middleware and the prerendered-404 path in the server entry. In dev, Astro matches unmatched URLs to the `/404` route, whose middleware pass is a prerendered one, so `isUnmatched()` in the server entry treats that as a miss unless `/404` itself was requested.

## Tests

- **Unit tests** (`test/*.test.js`) import the compiled modules in `dist/`. The runtime modules import `virtual:astro-hydrogen/config`, `virtual:astro-hydrogen/options`, `astro/app/entrypoint` and `astro/env/setup`, which only exist inside an Astro build. Each test file registers a Node loader hook (`node:module` `register()` with a `data:` URL) that resolves those specifiers to stubs backed by globals. For example `middleware.test.js` re-exports `globalThis.__hydrogenTestConfig` for the config, and `server.test.js` stubs `createApp()` with `globalThis.__fakeApp`. A test mutates the global, then imports and calls the real module. Copy the hook from the closest existing test.
- **Integration tests** (`test/integration/*.test.js`) call `buildFixture(name, { cdn, env })` from `test/helpers/fixture.js`, which runs `astro build` through the programmatic API on a fixture and starts the Worker in MiniOxygen. `cdn: true` bakes in `HYDROGEN_ASSET_BASE_URL` and serves `dist/client` from a simulated Oxygen CDN. `dev()` and `preview()` tests use the fixtures directly. `pack.test.js` packs the package as `npm publish` would and builds against the extracted tarball.
- **Test files run in parallel processes.** Fixture builds go to `dist/<mode>-<pid>`, and `freePort()` claims ports (4480-4499 for CDN servers, 4500-4519 for `astro dev`) with lock files. Keep test files independent of one another.
- **E2E** (`test/oxygen-worker.test.mjs`) builds `examples/mock-shop` and drives its Worker. It needs network access to mock.shop.
- **Scaffolder tests** (`packages/create-astro-hydrogen/test`) run the CLI against temp directories. The offline ones cover both modes and the config editor; the integration ones install the adapter from a pack of this checkout, because the release gate runs before the version the template pins exists on npm.

### Adding a fixture

1. Create `packages/astro-hydrogen/test/fixtures/<name>/` with `package.json` (`{ "private": true, "type": "module" }`), `astro.config.mjs` (import `astro-hydrogen`), `src/pages/`, and optionally `src/hydrogen.config.ts`. There is no per-fixture install: `astro`, `@shopify/hydrogen` and the workspace link of `astro-hydrogen` resolve from the root `node_modules`.
2. Add `test/integration/<name>.test.js` that builds it with `buildFixture('<name>')`, and dispose the site in `after()`.
3. Prefer pages that don't query Shopify. The tokenless mock.shop store is the default and needs network.
4. Add a row to `test/fixtures/README.md`.

## Releasing

CI runs on every push to `main` and every pull request; the release workflow runs on `v*` tags and publishes both packages with npm provenance, which requires this repository to stay public. See `.github/workflows`. `astro-hydrogen` and `create-astro-hydrogen` share one version: bump both `package.json` files, update `packages/astro-hydrogen/CHANGELOG.md`, run `npm test` once more, then tag. The scaffolder pins the adapter version it writes into new projects from the adapter's `package.json` at publish time.

## License

MIT
