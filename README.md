# astro-hydrogen

[![npm](https://img.shields.io/npm/v/astro-hydrogen)](https://www.npmjs.com/package/astro-hydrogen)
[![CI](https://github.com/1cm-Agency/astro-hydrogen-oxygen-adaptor/actions/workflows/ci.yml/badge.svg)](https://github.com/1cm-Agency/astro-hydrogen-oxygen-adaptor/actions/workflows/ci.yml)

An [Astro](https://astro.build/) adapter that deploys your storefront straight to [Shopify Oxygen](https://shopify.dev/docs/storefronts/headless/hydrogen/deployments). [Hydrogen](https://shopify.dev/docs/storefronts/headless/hydrogen) handles the commerce primitives. You bring the UI framework, or none at all.

## Why Astro Hydrogen

- **Hosting you already have.** Oxygen comes with your Shopify store. Deploy to it from the Shopify CLI, the same way a Hydrogen app does.
- **No React required.** Write plain `.astro` pages, and add islands in Preact, Solid, Svelte, React, Vue or anything else Astro supports. Shipping zero JavaScript is the default.
- **Hydrogen in every request.** A Storefront API client scoped to the buyer, plus Hydrogen's cart, search, checkout and redirect handlers, sessions, Customer Account login and analytics, all on `Astro.locals`.
- **The same runtime locally.** `astro dev` and `astro preview` run your server code in MiniOxygen, the workerd runtime Oxygen uses, so what works on your machine works in production.
- **Batteries for storefronts.** Components for prices, images, product forms, cart forms and Shop Pay, content collections fed from your catalog, and a route cache on Oxygen's Cache API.

## Quickstart

### Start a new storefront

```sh
npm create astro-hydrogen@latest my-shop
# or: pnpm create astro-hydrogen my-shop
# or: yarn create astro-hydrogen my-shop
# or: bun create astro-hydrogen my-shop
```

```sh
cd my-shop
npm run dev
```

You get a complete storefront with a product listing, product pages with a variant picker, a cart, search and a prerendered page. It runs against the public [mock.shop](https://mock.shop) demo store until you connect your own:

```sh
npx shopify hydrogen link
npx shopify hydrogen env pull
```

### Add to an existing Astro project

Run the same command inside your project:

```sh
npm create astro-hydrogen@latest .
```

It installs `astro-hydrogen`, `@shopify/hydrogen` and the Shopify CLI, sets `output: 'server'` and `adapter: hydrogen()` in your Astro config, adds a `deploy` script, and drops in a working product page and cart page. It never overwrites a file you already have.

`npx astro add astro-hydrogen` works too, but it only registers the integration. You then set `adapter: hydrogen()` and `output: 'server'` yourself, or your pages are prerendered by default.

### Your first page

Every page gets a Storefront API client on `Astro.locals.storefront`:

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

### Deploy

```sh
npm run deploy
```

That runs `shopify hydrogen deploy`, which builds your site and uploads the Worker and assets to Oxygen. See [Deploy to Oxygen and CI](packages/astro-hydrogen/README.md#deploy-to-oxygen-and-ci) for GitHub Actions.

## What's in the box

| | Read more |
| --- | --- |
| Storefront API client, buyer context, Hydrogen routes (`/api/cart`, search, checkout, redirects) | [How requests flow](packages/astro-hydrogen/README.md#how-requests-flow) |
| `Astro.locals.storefront`, `buyer`, `oxygen`, `shopifySession`, `customerAccount` | [`Astro.locals`](packages/astro-hydrogen/README.md#astrolocals) |
| Encrypted cookie sessions and Customer Account login | [Sessions](packages/astro-hydrogen/README.md#sessions), [Customer accounts](packages/astro-hydrogen/README.md#customer-accounts) |
| `<Money />`, `<ShopifyImage />`, `<ProductForm />`, `<CartForm />`, `<ShopPayButton />`, `<PredictiveSearchForm />`, `<ShopifyScripts />` | [Components](packages/astro-hydrogen/README.md#components) |
| Content collections from products, collections, pages and articles | [Content collections](packages/astro-hydrogen/README.md#content-collections) |
| Sub-request caching and a route cache on Oxygen | [Caching](packages/astro-hydrogen/README.md#caching) |
| Prerendering, `base`, Oxygen's asset CDN | [Prerendering, assets and `base`](packages/astro-hydrogen/README.md#prerendering-assets-and-base) |

## Documentation

- [Adapter reference](packages/astro-hydrogen/README.md): configuration, every feature, compatibility, troubleshooting.
- [`create-astro-hydrogen`](packages/create-astro-hydrogen/README.md): what the setup command does in each mode.
- [`examples/mock-shop`](examples/mock-shop): the example storefront, also the template new projects start from.
- [Changelog](packages/astro-hydrogen/CHANGELOG.md).

## Requirements

Node `^22.12 || ^24`, Astro `^7.0.0`, `@shopify/hydrogen` `>=2026.10.0`. Oxygen is a Worker runtime without Node.js APIs; the adapter tells you at build time when a dependency needs one.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains the repository layout, how the tests work and how releases are made.

## License

MIT
