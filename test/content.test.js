/** The content-collection loaders, driven directly with a stubbed `fetch`. */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { Cache } from '@shopify/hydrogen';

const hook = `
export async function resolve(specifier, context, next) {
  if (specifier === 'virtual:astro-hydrogen/config') return { url: 'astro-hydrogen-test:config', shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url === 'astro-hydrogen-test:config') {
    return { format: 'module', shortCircuit: true, source: 'export default globalThis.__hydrogenTestConfig;' };
  }
  return next(url, context);
}`;

const config = {};
globalThis.__hydrogenTestConfig = config;
const realFetch = globalThis.fetch;
const realEnv = { ...process.env };
const calls = [];
let respond;
let content;
let storefront;
let runtime;

before(async () => {
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
  content = await import('../dist/content/index.js');
  storefront = await import('../dist/content/storefront.js');
  runtime = await import('../dist/runtime/worker-runtime.js');
});

let domainCounter = 0;
beforeEach(() => {
  // A fresh domain per test keeps the in-memory cache and the client cache from leaking across tests.
  process.env.PUBLIC_STORE_DOMAIN = `shop${++domainCounter}.example.com`;
  delete process.env.PRIVATE_STOREFRONT_API_TOKEN;
  delete process.env.PUBLIC_STOREFRONT_API_TOKEN;
  for (const key of Object.keys(config)) delete config[key];
  calls.length = 0;
  respond = () => ({ data: {} });
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(url), headers: new Headers(init.headers), query: body.query, variables: body.variables ?? {} });
    return Response.json(respond(body, calls.length));
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(process.env, realEnv);
});

const product = (n, extra = {}) => ({
  id: `gid://shopify/Product/${n}`,
  handle: `p-${n}`,
  title: `Product ${n}`,
  descriptionHtml: `<p>About ${n}</p>`,
  updatedAt: `2026-01-0${n}T00:00:00Z`,
  ...extra,
});

/** A minimal stand-in for Astro's loader context. */
function loaderContext(initial = {}) {
  const map = new Map(Object.entries(initial));
  const parseCalls = [];
  const logs = [];
  return {
    map,
    parseCalls,
    logs,
    collection: 'products',
    store: {
      set: (entry) => (map.set(entry.id, entry), true),
      keys: () => [...map.keys()],
      delete: (id) => map.delete(id),
    },
    parseData: async (props) => (parseCalls.push(props), { ...props.data, parsed: true }),
    generateDigest: (data) => `digest:${JSON.stringify(data).length}`,
    logger: { info: (m) => logs.push(m) },
  };
}

describe('shopifyLoader (build time)', () => {
  it('paginates with pageInfo and the requested page size', async () => {
    respond = (body, n) => ({
      data: { products: { nodes: [product(n * 2 - 1), product(n * 2)], pageInfo: { hasNextPage: n < 2, endCursor: `c${n}` } } },
    });
    const ctx = loaderContext();
    await content.shopifyLoader({ resource: 'products', first: 2 }).load(ctx);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].variables.first, 2);
    assert.equal(calls[0].variables.after, undefined);
    assert.equal(calls[1].variables.after, 'c1');
    assert.deepEqual([...ctx.map.keys()], ['p-1', 'p-2', 'p-3', 'p-4']);
    assert.match(calls[0].query, /@inContext\(country: \$country, language: \$language\)/);
    assert.equal(calls[0].variables.country, 'US');
    assert.equal(calls[0].variables.language, 'EN');
    assert.match(ctx.logs[0], /Loaded 4 products in 2 requests/);
  });

  it('stores parsed data, a digest and rendered HTML', async () => {
    respond = () => ({ data: { products: { nodes: [product(1)], pageInfo: { hasNextPage: false } } } });
    const ctx = loaderContext();
    await content.shopifyLoader({ resource: 'products' }).load(ctx);

    assert.deepEqual(ctx.parseCalls.map((c) => c.id), ['p-1']);
    const entry = ctx.map.get('p-1');
    assert.equal(entry.data.parsed, true);
    assert.match(entry.digest, /^digest:/);
    assert.deepEqual(entry.rendered, { html: '<p>About 1</p>' });
  });

  it('renders page bodies and article content', async () => {
    respond = (body) =>
      body.query.includes('pages(')
        ? { data: { pages: { nodes: [{ id: 'gid://shopify/Page/1', handle: 'about', title: 'About', body: '<p>Us</p>' }], pageInfo: {} } } }
        : {
            data: {
              articles: {
                nodes: [{ id: 'gid://shopify/Article/1', handle: 'hi', title: 'Hi', contentHtml: '<p>Post</p>', blog: { handle: 'news', title: 'News' } }],
                pageInfo: {},
              },
            },
          };
    const pages = loaderContext();
    await content.shopifyLoader({ resource: 'pages' }).load(pages);
    assert.deepEqual(pages.map.get('about').rendered, { html: '<p>Us</p>' });

    const articles = loaderContext();
    await content.shopifyLoader({ resource: 'articles' }).load(articles);
    assert.deepEqual(articles.map.get('news/hi').rendered, { html: '<p>Post</p>' });
  });

  it('stops at max, trims the last page and drops entries that disappeared', async () => {
    respond = () => ({ data: { products: { nodes: [product(1), product(2), product(3)], pageInfo: { hasNextPage: true, endCursor: 'x' } } } });
    const ctx = loaderContext({ gone: { id: 'gone' } });
    await content.shopifyLoader({ resource: 'products', first: 10, max: 2 }).load(ctx);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].variables.first, 2);
    assert.deepEqual([...ctx.map.keys()], ['p-1', 'p-2']);
  });

  it('passes the search query and the i18n option', async () => {
    respond = () => ({ data: { products: { nodes: [], pageInfo: {} } } });
    await content
      .shopifyLoader({ resource: 'products', query: 'tag:sale', sortKey: 'TITLE', i18n: { country: 'CA', language: 'FR' } })
      .load(loaderContext());
    assert.equal(calls[0].variables.query, 'tag:sale');
    assert.equal(calls[0].variables.sortKey, 'TITLE');
    assert.equal(calls[0].variables.country, 'CA');
    assert.equal(calls[0].variables.language, 'FR');
  });

  it('uses config.i18n when it is an object', async () => {
    config.i18n = { country: 'GB', language: 'EN' };
    respond = () => ({ data: { products: { nodes: [], pageInfo: {} } } });
    await content.shopifyLoader({ resource: 'products' }).load(loaderContext());
    assert.equal(calls[0].variables.country, 'GB');
  });

  it('supports a generic query with its own entries mapping', async () => {
    const query = 'query Q($first: Int!, $after: String) { shop { name } things(first: $first, after: $after) { nodes { k } pageInfo { hasNextPage endCursor } } }';
    respond = (body, n) => ({
      data: { things: { nodes: [{ k: `k${n}` }], pageInfo: { hasNextPage: n < 3, endCursor: `e${n}` } } },
    });
    const ctx = loaderContext();
    await content
      .shopifyLoader({
        query,
        variables: { extra: 1 },
        first: 1,
        entries: (data) => data.things.nodes.map((n) => ({ id: n.k, data: n, body: `body ${n.k}` })),
      })
      .load(ctx);
    assert.deepEqual([...ctx.map.keys()], ['k1', 'k2', 'k3']);
    assert.equal(ctx.map.get('k1').body, 'body k1');
    assert.equal(calls[0].variables.extra, 1);
    assert.equal(calls[0].variables.country, undefined, 'context variables only go to queries that declare them');
  });

  it('throws a ShopifyLoaderError on GraphQL errors', async () => {
    respond = () => ({ errors: [{ message: 'Bad field' }] });
    await assert.rejects(
      () => content.shopifyLoader({ resource: 'products' }).load(loaderContext()),
      (error) => error instanceof content.ShopifyLoaderError && /Bad field/.test(error.message),
    );
  });

  it('ships a loose schema per resource', () => {
    const { products } = content.shopifySchemas;
    const parsed = products.parse({ id: 'a', handle: 'h', title: 'T', custom: 1 });
    assert.equal(parsed.custom, 1);
    assert.throws(() => products.parse({ id: 'a' }));
    assert.ok(content.shopifyLoader({ resource: 'pages' }).schema);
    assert.equal(content.shopifyLoader({ query: 'q', entries: () => [] }).schema, undefined);
  });
});

describe('shopifyLiveLoader (request time)', () => {
  it('loads a collection with a cache hint', async () => {
    respond = () => ({ data: { products: { nodes: [product(1), product(3), product(2)], pageInfo: {} } } });
    const loader = content.shopifyLiveLoader({ resource: 'products', cache: Cache({ maxAge: 30, staleWhileRevalidate: 60 }) });
    const result = await loader.loadCollection({ collection: 'liveProducts', filter: { first: 3, query: 'tag:a', reverse: true } });

    assert.equal(calls[0].variables.first, 3);
    assert.equal(calls[0].variables.query, 'tag:a');
    assert.equal(calls[0].variables.reverse, true);
    assert.deepEqual(result.entries.map((e) => e.id), ['p-1', 'p-3', 'p-2']);
    assert.deepEqual(result.entries[0].rendered, { html: '<p>About 1</p>' });
    assert.deepEqual(result.entries[0].cacheHint.tags, ['gid://shopify/Product/1']);
    assert.deepEqual(result.cacheHint.tags, ['shopify:products']);
    assert.equal(result.cacheHint.maxAge, 30);
    assert.equal(result.cacheHint.swr, 60);
    assert.equal(result.cacheHint.lastModified.toISOString(), '2026-01-03T00:00:00.000Z');
  });

  it('defaults to 20 entries and Cache.short()', async () => {
    respond = () => ({ data: { products: { nodes: [], pageInfo: {} } } });
    const result = await content.shopifyLiveLoader({ resource: 'products' }).loadCollection({ collection: 'c' });
    assert.equal(calls[0].variables.first, 20);
    assert.equal(result.cacheHint.maxAge, Cache.short().maxAge);
  });

  it('overrides the market through the filter', async () => {
    respond = () => ({ data: { products: { nodes: [], pageInfo: {} } } });
    const loader = content.shopifyLiveLoader({ resource: 'products', cache: Cache.none() });
    await loader.loadCollection({ collection: 'c', filter: { country: 'ca', language: 'fr' } });
    await loader.loadCollection({ collection: 'c' });
    assert.equal(calls[0].variables.country, 'CA');
    assert.equal(calls[0].variables.language, 'FR');
    assert.equal(calls[1].variables.country, 'US');
    const entry = await loader.loadEntry({ collection: 'c', filter: { handle: 'x', country: 'DE' } });
    assert.equal(entry, undefined);
    assert.equal(calls[2].variables.country, 'DE');
  });

  it('loads an entry by handle or id, and returns undefined when it does not exist', async () => {
    respond = (body) =>
      body.variables.handle === 'p-1' ? { data: { product: product(1) } } : { data: { product: null, node: null } };
    const loader = content.shopifyLiveLoader({ resource: 'products', cache: Cache.none() });

    const byHandle = await loader.loadEntry({ collection: 'c', filter: { handle: 'p-1' } });
    assert.equal(byHandle.id, 'p-1');
    assert.deepEqual(byHandle.cacheHint.tags, ['gid://shopify/Product/1', 'shopify:products']);
    assert.equal(byHandle.cacheHint.maxAge, 0);
    assert.match(calls[0].query, /product\(handle: \$handle\)/);

    const byId = await loader.loadEntry({ collection: 'c', filter: { id: 'p-1' } });
    assert.equal(byId.id, 'p-1');

    assert.equal(await loader.loadEntry({ collection: 'c', filter: { handle: 'nope' } }), undefined);
    assert.equal(await loader.loadEntry({ collection: 'c', filter: { id: 'gid://shopify/Product/9' } }), undefined);
    assert.match(calls.at(-1).query, /node\(id: \$id\)/);
    assert.equal(calls.at(-1).variables.id, 'gid://shopify/Product/9');
  });

  it('looks articles up as blog/handle', async () => {
    respond = () => ({
      data: { blog: { articleByHandle: { id: 'gid://shopify/Article/1', handle: 'hi', title: 'Hi', contentHtml: '<p>x</p>', blog: { handle: 'news', title: 'N' } } } },
    });
    const loader = content.shopifyLiveLoader({ resource: 'articles', cache: Cache.none() });
    const entry = await loader.loadEntry({ collection: 'c', filter: { handle: 'news/hi' } });
    assert.equal(entry.id, 'news/hi');
    assert.deepEqual(calls[0].variables.blog, 'news');
    assert.deepEqual(calls[0].variables.handle, 'hi');
    assert.equal(await loader.loadEntry({ collection: 'c', filter: { handle: 'no-blog' } }), undefined);
  });

  it('returns a ShopifyLoaderError for GraphQL and transport errors', async () => {
    const loader = content.shopifyLiveLoader({ resource: 'products', cache: Cache.none() });
    respond = () => ({ errors: [{ message: 'Throttled' }] });
    const collection = await loader.loadCollection({ collection: 'c' });
    assert.ok(collection.error instanceof content.ShopifyLoaderError);
    assert.match(collection.error.message, /Throttled/);
    const entry = await loader.loadEntry({ collection: 'c', filter: { handle: 'x' } });
    assert.ok(entry.error instanceof content.ShopifyLoaderError);

    globalThis.fetch = async () => new Response('nope', { status: 500 });
    const failed = await loader.loadCollection({ collection: 'c' });
    assert.ok(failed.error instanceof content.ShopifyLoaderError);
  });

  it('supports generic queries', async () => {
    const query = 'query Q($first: Int, $handle: String, $country: CountryCode) @inContext(country: $country) { things { k } }';
    respond = () => ({ data: { things: [{ k: 'a', updatedAt: '2026-02-01T00:00:00Z' }, { k: 'b' }] } });
    const loader = content.shopifyLiveLoader({
      query,
      cache: Cache.long(),
      entries: (data) => data.things.map((t) => ({ id: t.k, data: t })),
    });
    const collection = await loader.loadCollection({ collection: 'c', filter: { first: 5, country: 'fr' } });
    assert.deepEqual(collection.entries.map((e) => e.id), ['a', 'b']);
    assert.equal(calls[0].variables.first, 5);
    assert.equal(calls[0].variables.country, 'FR');
    assert.equal(calls[0].variables.language, undefined);
    assert.equal(collection.cacheHint.maxAge, Cache.long().maxAge);
    assert.deepEqual(collection.cacheHint.tags, ['shopify:query']);

    const entry = await loader.loadEntry({ collection: 'c', filter: { handle: 'h' } });
    assert.equal(entry.id, 'a');
    assert.equal(calls[1].variables.handle, 'h');
  });

  it('caches in the sub-request cache so a repeat does not hit the Storefront API', async () => {
    respond = () => ({ data: { products: { nodes: [product(1)], pageInfo: {} } } });
    const loader = content.shopifyLiveLoader({ resource: 'products', cache: Cache({ maxAge: 60 }) });
    await loader.loadCollection({ collection: 'c' });
    await loader.loadCollection({ collection: 'c' });
    assert.equal(calls.length, 1);
    await loader.loadCollection({ collection: 'c', filter: { first: 2 } });
    assert.equal(calls.length, 2, 'different variables are a different cache key');
  });

  it('shopifyCacheOptions maps a strategy to Astro.cache options', () => {
    assert.deepEqual(content.shopifyCacheOptions(Cache({ maxAge: 5, staleWhileRevalidate: 10 })), { maxAge: 5, swr: 10 });
    assert.deepEqual(content.shopifyCacheOptions(Cache.none()), { maxAge: 0 });
  });
});

describe('getCatalogClient', () => {
  it('uses private_no_buyer_context with a private token', async () => {
    process.env.PRIVATE_STOREFRONT_API_TOKEN = 'priv-token';
    respond = () => ({ data: {} });
    const { client } = storefront.getCatalogClient();
    await client.graphql('query { shop { name } }');
    assert.equal(calls[0].headers.get('shopify-storefront-private-token'), 'priv-token');
    assert.equal(calls[0].headers.get('shopify-storefront-buyer-ip'), null);
  });

  it('uses the public token otherwise, and no token for the demo store', async () => {
    process.env.PUBLIC_STOREFRONT_API_TOKEN = 'pub-token';
    await storefront.getCatalogClient().client.graphql('query { shop { name } }');
    assert.equal(calls[0].headers.get('x-shopify-storefront-access-token'), 'pub-token');
    assert.equal(calls[0].headers.get('shopify-storefront-private-token'), null);
  });

  it('is cached per market and environment', () => {
    const a = storefront.getCatalogClient();
    assert.equal(storefront.getCatalogClient(), a);
    assert.notEqual(storefront.getCatalogClient({ i18n: { country: 'CA', language: 'FR' } }), a);
    process.env.PUBLIC_STORE_DOMAIN = 'other.example.com';
    assert.notEqual(storefront.getCatalogClient(), a);
  });

  it('takes env and cache from the worker runtime once it is set', async () => {
    const stored = new Map();
    const cache = {
      match: async (req) => stored.get(req.url)?.clone(),
      put: async (req, res) => void stored.set(req.url, res),
      delete: async () => true,
    };
    runtime.setWorkerRuntime({ env: { PUBLIC_STORE_DOMAIN: 'worker.example.com', PRIVATE_STOREFRONT_API_TOKEN: 'w-token' }, cache });
    try {
      assert.equal(runtime.getWorkerRuntime().cache, cache);
      respond = () => ({ data: { products: { nodes: [product(1)], pageInfo: {} } } });
      const loader = content.shopifyLiveLoader({ resource: 'products', cache: Cache({ maxAge: 60 }) });
      await loader.loadCollection({ collection: 'c' });
      await loader.loadCollection({ collection: 'c' });
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /worker\.example\.com/);
      assert.equal(calls[0].headers.get('shopify-storefront-private-token'), 'w-token');
      assert.ok(stored.size > 0, 'the response went to the Worker cache');
    } finally {
      runtime.setWorkerRuntime(undefined);
    }
  });
});
