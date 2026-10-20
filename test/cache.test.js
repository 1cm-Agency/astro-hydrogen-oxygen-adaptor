import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import oxygenCacheProvider, { oxygenCache, parseCdnCacheControl, pathKey } from '../dist/cache/oxygen.js';

/** A minimal Cache API: open/match/put/delete on a Map. `stores` is exposed for assertions. */
function fakeCaches() {
  const stores = new Map();
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(request) {
          const found = entries.get(request.url);
          return found && new Response(found.body.slice(0), { status: found.status, headers: found.headers });
        },
        async put(request, response) {
          assert.equal(new URL(request.url).protocol, 'https:');
          entries.set(request.url, { body: await response.arrayBuffer(), status: response.status, headers: [...response.headers] });
        },
        async delete(request) {
          return entries.delete(request.url);
        },
      };
    },
  };
}

function setup(options) {
  const warnings = [];
  const waiting = [];
  const logger = { info() {}, warn: (m) => warnings.push(m), error() {} };
  const provider = oxygenCacheProvider(options);
  let renders = 0;
  const run = (path = '/page', { waitUntil: hook = (p) => waiting.push(p), headers = {}, method = 'GET', body = 'body' } = {}) => {
    const url = new URL(path, 'https://shop.test');
    return provider.onRequest({ request: new Request(url, { method }), url, waitUntil: hook ?? undefined, logger }, async () => {
      renders++;
      return new Response(`${body} ${renders}`, {
        headers: { 'content-type': 'text/html', 'cdn-cache-control': 'max-age=60, stale-while-revalidate=300', 'cache-tag': 'a, b', ...headers },
      });
    });
  };
  const settle = async () => {
    while (waiting.length) await waiting.shift();
  };
  return { provider, run, settle, warnings, renders: () => renders };
}

describe('oxygenCache() config helper', () => {
  it('returns a serializable provider reference', () => {
    const config = oxygenCache({ cacheName: 'x', keyPrefix: 'v2' });
    assert.equal(config.name, 'oxygen');
    assert.equal(config.entrypoint, 'astro-hydrogen/runtime/oxygen-cache');
    assert.deepEqual(JSON.parse(JSON.stringify(config.config)), { cacheName: 'x', keyPrefix: 'v2' });
  });
});

describe('helpers', () => {
  it('parses CDN-Cache-Control', () => {
    assert.deepEqual(parseCdnCacheControl('max-age=10, stale-while-revalidate=20'), { maxAge: 10, swr: 20 });
    assert.deepEqual(parseCdnCacheControl(null), { maxAge: 0, swr: 0 });
  });
  it('sorts the query and drops tracking parameters', () => {
    assert.equal(pathKey(new URL('https://a.test/p?b=2&utm_source=x&a=1')), '/p?a=1&b=2');
  });
});

describe('oxygen route cache provider', () => {
  const realCaches = globalThis.caches;
  const realNow = Date.now;
  let now;
  let fake;
  beforeEach(() => {
    fake = fakeCaches();
    globalThis.caches = fake;
    now = 1_000_000;
    Date.now = () => now;
  });
  afterEach(() => {
    globalThis.caches = realCaches;
    Date.now = realNow;
  });

  it('misses, then hits without rendering again', async () => {
    const t = setup();
    const miss = await t.run();
    assert.equal(miss.headers.get('x-astro-cache'), 'MISS');
    assert.equal(await miss.text(), 'body 1');
    await t.settle();
    const hit = await t.run();
    assert.equal(hit.headers.get('x-astro-cache'), 'HIT');
    assert.equal(await hit.text(), 'body 1');
    assert.equal(t.renders(), 1);
    assert.equal(hit.headers.get('content-type'), 'text/html');
    assert.equal(hit.headers.get('cache-control'), null, 'internal storage headers are not exposed');
    assert.equal(hit.headers.get('x-astro-hydrogen-stored-at'), null);
  });

  it('stores under synthetic https keys in the named cache', async () => {
    const t = setup({ cacheName: 'custom', keyPrefix: 'v1' });
    await t.run();
    await t.settle();
    const keys = [...fake.stores.get('custom').keys()];
    assert.equal(keys.length, 1);
    assert.match(keys[0], /^https:\/\/astro-hydrogen\.cache\/v1\/page\/[0-9a-f]{64}$/);
  });

  it('hashes long and awkward paths into a fixed-size key', async () => {
    const t = setup();
    await t.run(`/p?q=${'x'.repeat(5000)}`);
    await t.settle();
    const [key] = [...fake.stores.get('astro-routes').keys()];
    assert.ok(key.length < 120);
    assert.equal((await t.run(`/p?q=${'x'.repeat(5000)}`)).headers.get('x-astro-cache'), 'HIT');
  });

  it('shares an entry across tracking params and query order', async () => {
    const t = setup();
    await t.run('/p?a=1&b=2');
    await t.settle();
    assert.equal((await t.run('/p?utm_source=z&b=2&a=1')).headers.get('x-astro-cache'), 'HIT');
    assert.equal((await t.run('/p?a=2&b=2')).headers.get('x-astro-cache'), 'MISS');
  });

  it('serves stale inside the SWR window and revalidates through waitUntil', async () => {
    const t = setup();
    await t.run();
    await t.settle();
    now += 61_000;
    const stale = await t.run();
    assert.equal(stale.headers.get('x-astro-cache'), 'STALE');
    assert.equal(await stale.text(), 'body 1');
    assert.equal(t.renders(), 2, 'a revalidation was scheduled');
    await t.run(); // a second stale hit must not start a second revalidation
    assert.equal(t.renders(), 2);
    await t.settle();
    const fresh = await t.run();
    assert.equal(fresh.headers.get('x-astro-cache'), 'HIT');
    assert.equal(await fresh.text(), 'body 2');
  });

  it('renders in the foreground for a stale entry when there is no waitUntil', async () => {
    const t = setup();
    await t.run();
    await t.settle();
    now += 61_000;
    const res = await t.run('/page', { waitUntil: null });
    assert.equal(await res.text(), 'body 2');
    assert.equal(res.headers.get('x-astro-cache'), 'MISS');
  });

  it('treats an entry past maxAge + swr as expired', async () => {
    const t = setup();
    await t.run();
    await t.settle();
    now += 361_000;
    const res = await t.run();
    assert.equal(res.headers.get('x-astro-cache'), 'MISS');
    assert.equal(await res.text(), 'body 2');
  });

  it('stores in the foreground when there is no waitUntil', async () => {
    const t = setup();
    await t.run('/page', { waitUntil: null });
    assert.equal((await t.run('/page', { waitUntil: null })).headers.get('x-astro-cache'), 'HIT');
  });

  it('skips responses with Set-Cookie, private or no-store, a cookie Vary, or a non-200 status', async () => {
    const t = setup();
    const cases = [
      { 'set-cookie': 'a=b' },
      { 'cache-control': 'private, max-age=5' },
      { 'cache-control': 'no-store' },
      { vary: 'Cookie' },
    ];
    for (const headers of cases) {
      const res = await t.run('/skip', { headers });
      await res.text();
      await t.settle();
    }
    assert.equal(fake.stores.get('astro-routes')?.size ?? 0, 0);
    assert.equal(t.warnings.length, cases.length);
    assert.match(t.warnings[0], /Set-Cookie|sets a cookie/);
  });

  it('skips responses without max-age and non-GET requests', async () => {
    const t = setup();
    await t.run('/p', { headers: { 'cdn-cache-control': 'stale-while-revalidate=10' } });
    await t.run('/p', { method: 'POST' });
    await t.settle();
    assert.equal(fake.stores.get('astro-routes')?.size ?? 0, 0);
  });

  it('keeps the original Cache-Control for the client on hits', async () => {
    const t = setup();
    await t.run('/p', { headers: { 'cache-control': 'public, max-age=5' } });
    await t.settle();
    assert.equal((await t.run('/p')).headers.get('cache-control'), 'public, max-age=5');
  });

  it('invalidates by tag, by path, and leaves other entries alone', async () => {
    const t = setup();
    for (const path of ['/one', '/two']) {
      await t.run(path);
      await t.settle();
    }
    await t.run('/other', { headers: { 'cache-tag': 'c' } });
    await t.settle();

    now += 10;
    await t.provider.invalidate({ tags: 'a' });
    now += 10; // an entry stored in the same millisecond as the invalidation counts as invalidated
    assert.equal((await t.run('/one')).headers.get('x-astro-cache'), 'MISS');
    await t.settle();
    assert.equal((await t.run('/one')).headers.get('x-astro-cache'), 'HIT', 'stored again after the invalidation');
    assert.equal((await t.run('/other')).headers.get('x-astro-cache'), 'HIT');

    now += 10;
    await t.provider.invalidate({ path: '/other' });
    assert.equal((await t.run('/other')).headers.get('x-astro-cache'), 'MISS');
    await t.provider.invalidate({});
  });

  it('is a pass-through with a single warning when the Cache API is missing', async () => {
    globalThis.caches = undefined;
    delete globalThis.caches;
    const t = setup();
    assert.equal(await (await t.run()).text(), 'body 1');
    assert.equal(await (await t.run()).text(), 'body 2');
    assert.equal(t.warnings.length, 1);
    assert.match(t.warnings[0], /Cache API is not available/);
    await t.provider.invalidate({ tags: 'a' }); // does not throw
  });

  it('falls through to a render when the cache throws', async () => {
    globalThis.caches = { open: async () => { throw new Error('boom'); } };
    const t = setup();
    assert.equal(await (await t.run()).text(), 'body 1');
    assert.match(t.warnings[0], /lookup failed/);
  });
});
