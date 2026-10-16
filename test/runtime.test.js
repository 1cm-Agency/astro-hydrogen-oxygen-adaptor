import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { createShopifyRequestContext } from '@shopify/hydrogen';
import { fetchPrerenderedPage, isStaticAssetSubrequest } from '../dist/runtime/assets.js';
import { getMemoryCache } from '../dist/runtime/memory-cache.js';
import { createRequestSessionManager } from '../dist/runtime/session.js';
import { createDefaultStorefrontClient } from '../dist/runtime/storefront.js';

describe('fetchPrerenderedPage', () => {
  afterEach(() => mock.restoreAll());

  function mockFetch(handler) {
    const calls = [];
    mock.method(globalThis, 'fetch', async (url, init) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) });
      return handler(String(url));
    });
    return calls;
  }

  it('fetches directory-format pages from the Oxygen CDN', async () => {
    const calls = mockFetch(() => new Response('<h1>About</h1>', { headers: { 'set-cookie': 'a=b' } }));
    const response = await fetchPrerenderedPage(
      new Request('https://shop.example/about'),
      '/about',
      'https://cdn.shopify.com/oxygen/1/2/3',
    );

    assert.equal(calls[0].url, 'https://cdn.shopify.com/oxygen/1/2/3/about/index.html');
    assert.equal(calls[0].headers.get('x-astro-hydrogen-asset'), '1');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(await response.text(), '<h1>About</h1>');
  });

  it('falls back to file-format pages, then gives up', async () => {
    const calls = mockFetch((url) => new Response(null, { status: url.endsWith('/about.html') ? 200 : 404 }));
    assert.ok(await fetchPrerenderedPage(new Request('https://shop.example/about'), '/about', undefined));
    assert.deepEqual(
      calls.map((call) => call.url),
      ['https://shop.example/about/index.html', 'https://shop.example/about.html'],
    );

    mockFetch(() => new Response(null, { status: 404 }));
    assert.equal(await fetchPrerenderedPage(new Request('https://shop.example/x'), '/x', undefined), undefined);
  });

  it('serves error pages by exact path and HEAD without a body', async () => {
    const calls = mockFetch(() => new Response('<h1>404</h1>'));
    const response = await fetchPrerenderedPage(
      new Request('https://shop.example/missing', { method: 'HEAD' }),
      '/404.html',
      undefined,
    );
    assert.equal(calls[0].url, 'https://shop.example/404.html');
    assert.equal(response.body, null);
  });

  it('ignores non-GET requests and marks its own subrequests', async () => {
    const calls = mockFetch(() => new Response('x'));
    const post = new Request('https://shop.example/about', { method: 'POST' });
    assert.equal(await fetchPrerenderedPage(post, '/about', undefined), undefined);
    assert.equal(calls.length, 0);

    assert.equal(isStaticAssetSubrequest(post), false);
    assert.equal(
      isStaticAssetSubrequest(new Request('https://shop.example', { headers: { 'x-astro-hydrogen-asset': '1' } })),
      true,
    );
  });
});

describe('getMemoryCache', () => {
  it('stores values until their ttl expires', async () => {
    const cache = getMemoryCache();
    await cache.set('fresh', { a: 1 }, { ttl: 60 });
    await cache.set('stale', { b: 2 }, { ttl: -1 });
    assert.deepEqual(await cache.get('fresh'), { a: 1 });
    assert.equal(await cache.get('stale'), undefined);
    await cache.delete('fresh');
    assert.equal(await cache.get('fresh'), undefined);
    assert.equal(getMemoryCache(), cache);
  });
});

describe('createRequestSessionManager', () => {
  it('keeps values for one request and reports its origin', async () => {
    const session = createRequestSessionManager(new Request('https://shop.example/account?x=1'));
    assert.equal(await session.getSessionOrigin(), 'https://shop.example');
    await session.setSessionItem('k', 'v');
    assert.equal(await session.getSessionItem('k'), 'v');
    await session.removeSessionItem('k');
    assert.equal(await session.getSessionItem('k'), undefined);
  });
});

describe('createDefaultStorefrontClient', () => {
  const i18n = { country: 'US', language: 'EN' };
  const request = new Request('https://shop.example/');
  const base = { request, url: new URL(request.url), runtime: undefined, cache: getMemoryCache(), waitUntil: undefined };

  it('uses a private client when it has a private token and a buyer IP', () => {
    const client = createDefaultStorefrontClient({
      ...base,
      env: { PUBLIC_STORE_DOMAIN: 'shop.myshopify.com', PRIVATE_STOREFRONT_API_TOKEN: 'shpat_x' },
      requestContext: createShopifyRequestContext({ request, i18n, buyerIp: '1.2.3.4' }),
      buyerIp: '1.2.3.4',
      isPrerendered: false,
    });
    assert.equal(client.type, 'private');
    assert.equal(client.storeUrl, 'https://shop.myshopify.com');
  });

  it('uses a buyer-less private client while prerendering', () => {
    const client = createDefaultStorefrontClient({
      ...base,
      env: { PUBLIC_STORE_DOMAIN: 'shop.myshopify.com', PRIVATE_STOREFRONT_API_TOKEN: 'shpat_x' },
      requestContext: createShopifyRequestContext({ request: { headers: new Headers() }, i18n }),
      buyerIp: undefined,
      isPrerendered: true,
    });
    assert.equal(client.type, 'private_no_buyer_context');
  });

  it('falls back to a tokenless public client on mock.shop, treating empty values as unset', (t) => {
    t.mock.method(console, 'warn', () => {});
    const client = createDefaultStorefrontClient({
      ...base,
      env: { PUBLIC_STORE_DOMAIN: '', PUBLIC_STOREFRONT_API_TOKEN: '' },
      requestContext: createShopifyRequestContext({ request, i18n }),
      buyerIp: undefined,
      isPrerendered: false,
    });
    assert.equal(client.type, 'public');
    assert.equal(client.storeUrl, 'https://mock.shop');
  });
});
