/** The shared request setup, driven directly. (The middleware tests cover it through `onRequest`.) */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { before, beforeEach, afterEach, describe, it } from 'node:test';
import { createShopifyRouteHandler } from '@shopify/hydrogen';

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

const ENV = { PUBLIC_STORE_DOMAIN: 'shop.myshopify.com', PRIVATE_STOREFRONT_API_TOKEN: 'priv-token' };
const config = {};
globalThis.__hydrogenTestConfig = config;
const realFetch = globalThis.fetch;
const fetchCalls = [];
let redirectTarget;
let mod;

before(async () => {
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
  mod = await import('../dist/runtime/hydrogen-request.js');
});
beforeEach(() => {
  for (const key of Object.keys(config)) delete config[key];
  fetchCalls.length = 0;
  redirectTarget = undefined;
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), body: String(init?.body) });
    const edges = redirectTarget ? [{ node: { target: redirectTarget } }] : [];
    return Response.json({ data: { urlRedirects: { edges } } });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const runtime = () => ({ env: ENV, waitUntil() {}, cache: undefined });
function args(path, { method = 'GET', headers, isPrerendered = false, rt = runtime() } = {}) {
  const url = new URL(path, 'https://shop.example');
  return { request: new Request(url, { method, headers, redirect: 'manual' }), url, runtime: rt ?? undefined, isPrerendered };
}

describe('prepareHydrogenRequest', () => {
  it('returns only a storefront and request context while prerendering', async () => {
    const prepared = await mod.prepareHydrogenRequest(args('/p', { isPrerendered: true }));
    assert.equal(prepared.storefront.type, 'private_no_buyer_context');
    assert.ok(prepared.requestContext);
    assert.equal(prepared.buyer, undefined);
    assert.equal(prepared.sessionManager, undefined);
    assert.equal(prepared.handlers, undefined);
  });

  it('adds buyer, session and the default handlers for a request', async () => {
    const prepared = await mod.prepareHydrogenRequest(
      args('/p', { headers: { 'oxygen-buyer-ip': '203.0.113.7', 'oxygen-buyer-country': 'CA' } }),
    );
    assert.equal(prepared.buyer.ip, '203.0.113.7');
    assert.equal(prepared.buyer.country, 'CA');
    assert.ok(prepared.sessionManager);
    assert.equal(prepared.handlers.length, 2);
    assert.equal(prepared.customerAccount, undefined);
    assert.equal(prepared.customerSession, undefined);
  });

  it('passes the request context to a custom storefront factory', async () => {
    let received;
    config.storefront = (value) => ((received = value), { type: 'custom' });
    const prepared = await mod.prepareHydrogenRequest(args('/p'));
    assert.equal(prepared.storefront.type, 'custom');
    assert.equal(received.requestContext, prepared.requestContext);
    assert.equal(received.isPrerendered, false);
  });
});

describe('handleUnmatchedRequest', () => {
  const run = (path, options) => mod.handleUnmatchedRequest(args(path, options));

  it('serves a Hydrogen route', async () => {
    const response = await run('/api/cart');
    assert.ok(response);
    assert.notEqual(response.status, 404);
  });

  it('uses custom handlers', async () => {
    config.handlers = [
      { ping: createShopifyRouteHandler('/api/ping', 'GET', async () => ({ type: 'json', data: { pong: true } })) },
    ];
    assert.deepEqual(await (await run('/api/ping')).json(), { pong: true });
    assert.equal(await run('/api/cart'), undefined);
  });

  it('redirects /admin without a network request', async () => {
    const response = await run('/admin');
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), 'https://shop.myshopify.com/admin');
    assert.equal(fetchCalls.length, 0);
  });

  it('follows a store URL redirect, and returns undefined when there is none', async () => {
    redirectTarget = '/new-place';
    const response = await run('/old-place');
    assert.equal(response.status, 301);
    assert.match(response.headers.get('location'), /\/new-place$/);
    redirectTarget = undefined;
    assert.equal(await run('/nowhere'), undefined);
  });

  it('honours shopifyRoutes: false and shopifyRedirects: false', async () => {
    config.shopifyRoutes = false;
    assert.equal(await run('/api/cart'), undefined);
    assert.equal((await run('/admin')).status, 301);
    config.shopifyRedirects = false;
    fetchCalls.length = 0;
    assert.equal(await run('/api/cart'), undefined);
    assert.equal(await run('/admin'), undefined);
    assert.equal(fetchCalls.length, 0);
  });

  it('falls back to process.env when there is no Worker runtime', async () => {
    process.env.PUBLIC_STORE_DOMAIN = 'env.myshopify.com';
    try {
      const response = await run('/admin', { rt: null });
      assert.equal(response.headers.get('location'), 'https://env.myshopify.com/admin');
    } finally {
      delete process.env.PUBLIC_STORE_DOMAIN;
    }
  });
});
