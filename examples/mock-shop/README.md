# mock-shop example

A small framework-free Astro storefront on the [astro-hydrogen](../../packages/astro-hydrogen) adapter. It runs against the tokenless [mock.shop](https://mock.shop) demo store, so it needs no configuration.

## Run it

From the repo root or from this folder:

```sh
npm install && npm run dev
```

Without `PUBLIC_STORE_DOMAIN` the adapter falls back to mock.shop and logs a warning.

## Use a real store

Link the project and pull its environment (`npx shopify hydrogen link`, then `npx shopify hydrogen env pull`), or copy `.env.example` to `.env` and fill it in.

## Deploy to Oxygen

```sh
npm run build && npm run deploy
```

## What each page shows

- `/`: Storefront API data through `Astro.locals.storefront`, with `<ShopifyImage />` and `<Money />`.
- `/products/[handle]`: `<ProductForm />` with variant links that work without JavaScript, and a 404 for unknown handles.
- `/cart`: the cart read on the server with `getCart`, edited with `<CartForm />`. It works with JavaScript disabled.
- `/search`: a `products(query:)` search behind the `<PredictiveSearchForm />` in the header.
- `/about`: a prerendered page served from the asset CDN.
- `/api/runtime.json`: what the Oxygen runtime provides on `Astro.locals`.
- `src/hydrogen.config.ts`: the adapter's runtime config.
