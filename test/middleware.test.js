/**
 * Drives the real middleware with a mutable stand-in for `virtual:astro-hydrogen/config`: the
 * loader hook re-exports `globalThis.__hydrogenTestConfig`, and each test resets that object.
 * (`routeTemplates` and `customerAccount` are read at module load; see middleware-routes.test.js
 * and customer-account.test.js.)
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { before, beforeEach, afterEach, describe, it } from 'node:test';
import { createShopifyRouteHandler, createStorefrontClient } from '@shopify/hydrogen';

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
let onRequest;

before(async () => {
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
  ({ onRequest } = await import('../dist/entrypoints/middleware.js'));
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

async function run(path, { env = ENV, runtime, headers, method = 'GET', isPrerendered = false, next } = {}) {
  const url = new URL(path, 'https://shop.example');
  const request = new Request(url, { method, headers, redirect: 'manual' });
  const locals = runtime === null ? {} : { oxygen: { env, waitUntil() {}, cache: undefined, ...runtime } };
  let nextCalls = 0;
  const nextResponse = next ?? (() => new Response('page'));
  const response = await onRequest({ request, url, locals, isPrerendered }, async () => {
    nextCalls++;
    return nextResponse();
  });
  return { response, locals, nextCalls };
}

describe('middleware: storefront client', () => {
  it('uses private_no_buyer_context for prerendered pages, with no buyer or session, and returns next() untouched', async () => {
    const page = new Response('static');
    const { response, locals, nextCalls } = await run('/p', { isPrerendered: true, next: () => page });
    assert.equal(response, page);
    assert.equal(nextCalls, 1);
    assert.equal(locals.storefront.type, 'private_no_buyer_context');
    assert.ok(locals.shopifyRequestContext);
    assert.equal(locals.buyer, undefined);
    assert.equal(locals.shopifySession, undefined);
    assert.equal(response.headers.get('powered-by'), null);
  });

  it('prerendering falls back to process.env when there is no Worker runtime', async () => {
    process.env.PUBLIC_STORE_DOMAIN = 'env.myshopify.com';
    process.env.PRIVATE_STOREFRONT_API_TOKEN = 'from-process';
    try {
      const { locals } = await run('/p', { isPrerendered: true, runtime: null });
      assert.equal(locals.storefront.type, 'private_no_buyer_context');
      assert.ok(locals.storefront.storeUrl.includes('env.myshopify.com'), locals.storefront.storeUrl);
    } finally {
      delete process.env.PUBLIC_STORE_DOMAIN;
      delete process.env.PRIVATE_STOREFRONT_API_TOKEN;
    }
  });

  it('uses a private client for an SSR request with a buyer IP, public without one', async () => {
    const withIp = await run('/p', { headers: { 'oxygen-buyer-ip': '203.0.113.9, 10.0.0.1', 'oxygen-buyer-country': 'CA' } });
    assert.equal(withIp.locals.storefront.type, 'private');
    assert.equal(withIp.locals.buyer.ip, '203.0.113.9');
    assert.equal(withIp.locals.buyer.country, 'CA');
    assert.equal(withIp.response.headers.get('powered-by'), 'Shopify, Hydrogen');

    const noIp = await run('/p');
    assert.equal(noIp.locals.storefront.type, 'public');
    assert.equal(noIp.locals.buyer.ip, undefined);

    const noToken = await run('/p', { env: { PUBLIC_STORE_DOMAIN: 'x.myshopify.com' }, headers: { 'oxygen-buyer-ip': '1.2.3.4' } });
    assert.equal(noToken.locals.storefront.type, 'public');
  });

  it('honours a custom getBuyerIp', async () => {
    let received;
    config.getBuyerIp = (args) => ((received = args), '198.51.100.4');
    const { locals } = await run('/p');
    assert.equal(locals.storefront.type, 'private');
    assert.equal(locals.buyer.ip, '198.51.100.4');
    assert.equal(received.isPrerendered, false);
    assert.equal(received.env, ENV);
  });

  it('applies the default, static and function i18n', async () => {
    const pick = ({ country, language }) => ({ country, language });
    assert.deepEqual(pick((await run('/p')).locals.storefront.i18n), { country: 'US', language: 'EN' });
    config.i18n = { country: 'CA', language: 'FR' };
    assert.deepEqual(pick((await run('/p')).locals.storefront.i18n), { country: 'CA', language: 'FR' });
    let args;
    config.i18n = async (value) => ((args = value), { country: 'GB', language: 'EN' });
    const { locals } = await run('/en-gb/p');
    assert.deepEqual(pick(locals.storefront.i18n), { country: 'GB', language: 'EN' });
    assert.equal(args.url.pathname, '/en-gb/p');
    assert.equal(args.request.method, 'GET');
    assert.equal(args.env, ENV);
    assert.equal(args.isPrerendered, false);
    assert.equal(args.runtime, locals.oxygen);
  });

  it('passes the documented args to a custom storefront hook and uses its result', async () => {
    let args;
    let custom;
    config.storefront = async (value) => {
      args = value;
      return (custom = createStorefrontClient({ type: 'public', requestContext: value.requestContext, config: { storeDomain: 'custom.myshopify.com' } }));
    };
    const cache = { name: 'worker-cache' };
    const waitUntil = () => {};
    const { locals } = await run('/p', { runtime: { cache, waitUntil }, headers: { 'oxygen-buyer-ip': '203.0.113.9' } });
    assert.equal(locals.storefront, custom);
    assert.equal(args.cache, cache);
    assert.equal(args.waitUntil, waitUntil);
    assert.equal(args.buyerIp, '203.0.113.9');
    assert.equal(args.isPrerendered, false);
    assert.equal(args.env, ENV);
    assert.equal(typeof args.requestContext.applyResponseHeaders, 'function');
    assert.equal(args.request.url, 'https://shop.example/p');
  });

  it('falls back to an in-memory cache and no buyerIp when prerendering', async () => {
    let args;
    config.storefront = (value) => ((args = value), { type: 'custom' });
    await run('/p', { isPrerendered: true, headers: { 'oxygen-buyer-ip': '203.0.113.9' } });
    assert.equal(args.buyerIp, undefined);
    assert.equal(args.isPrerendered, true);
    args.cache.set('k', 'v', { ttl: 60 });
    assert.equal(args.cache.get('k'), 'v');
    args.cache.delete('k');
    assert.equal(args.cache.get('k'), undefined);
  });
});

describe('middleware: session', () => {
  it('passes args to a custom sessionManager and appends its commit() headers', async () => {
    let args;
    const manager = { commit: async () => ({ 'set-cookie': 'custom=1; Path=/' }) };
    config.sessionManager = async (value) => ((args = value), manager);
    const { response, locals } = await run('/p');
    assert.equal(locals.shopifySession, manager);
    assert.equal(args.url.pathname, '/p');
    assert.equal(args.env, ENV);
    assert.equal(response.headers.get('set-cookie'), 'custom=1; Path=/');
  });

  it('uses a cookie session when SESSION_SECRET is set, in-memory otherwise', async () => {
    const memory = await run('/p');
    await memory.locals.shopifySession.setSessionItem('k', 'v');
    assert.equal(await memory.locals.shopifySession.getSessionItem('k'), 'v');
    assert.equal(memory.response.headers.get('set-cookie'), null);

    const secret = 'a-secret-of-reasonable-length-1234';
    const cookie = await run('/p', {
      env: { ...ENV, SESSION_SECRET: secret },
      next: async () => new Response('page'),
    });
    await cookie.locals.shopifySession.setSessionItem('k', 'v');
    const headers = new Headers(await cookie.locals.shopifySession.commit());
    assert.match(headers.get('set-cookie'), /^__Host-session=/);
  });
});

describe('middleware: Shopify routes and handlers', () => {
  const custom = () => ({
    ping: createShopifyRouteHandler('/api/ping', 'GET', async () => ({ type: 'json', data: { pong: true } })),
  });

  it('serves the default cart handler and skips next()', async () => {
    const { response, nextCalls } = await run('/api/cart', { method: 'GET' });
    assert.equal(nextCalls, 0);
    assert.notEqual(response.status, 404);
  });

  it('a handlers array replaces the defaults, so /api/cart falls through to a 404', async () => {
    config.handlers = [custom()];
    const ping = await run('/api/ping');
    assert.equal(ping.nextCalls, 0);
    assert.deepEqual(await ping.response.json(), { pong: true });

    const cart = await run('/api/cart', { next: () => new Response('nope', { status: 404 }) });
    assert.equal(cart.nextCalls, 1);
    assert.equal(cart.response.status, 404);
  });

  it('a handlers function receives the defaults and extends them', async () => {
    let args;
    config.handlers = (value) => ((args = value), [...value.defaults, custom()]);
    const ping = await run('/api/ping');
    assert.deepEqual(await ping.response.json(), { pong: true });
    assert.equal(args.defaults.length, 2);
    assert.equal(args.url.pathname, '/api/ping');
    assert.equal(args.isPrerendered, false);
    assert.equal((await run('/api/cart')).nextCalls, 0);
  });

  it('shopifyRoutes: false skips Hydrogen routes', async () => {
    config.handlers = [custom()];
    config.shopifyRoutes = false;
    const { response, nextCalls } = await run('/api/ping');
    assert.equal(nextCalls, 1);
    assert.equal(await response.text(), 'page');
  });
});

describe('middleware: redirects on 404', () => {
  const notFound = () => new Response('missing', { status: 404 });

  it('redirects /admin to the store admin without a network request', async () => {
    const { response } = await run('/admin', { next: notFound });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), 'https://shop.myshopify.com/admin');
    assert.equal(fetchCalls.length, 0);
  });

  it('keeps the 404 when shopifyRedirects is false', async () => {
    config.shopifyRedirects = false;
    const { response } = await run('/admin', { next: notFound });
    assert.equal(response.status, 404);
    assert.equal(fetchCalls.length, 0);
  });

  it('follows a store URL redirect found through the Storefront API', async () => {
    redirectTarget = '/new-place';
    const { response } = await run('/old-place', { next: notFound });
    assert.equal(response.status, 301);
    assert.match(response.headers.get('location'), /\/new-place$/);
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].body, /path:\/old-place/);
  });

  it('returns the 404 when there is no redirect', async () => {
    const { response } = await run('/old-place', { next: notFound });
    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'missing');
    assert.equal(response.headers.get('powered-by'), 'Shopify, Hydrogen');
  });

  it('does not look up redirects for non-404 responses', async () => {
    await run('/old-place');
    assert.equal(fetchCalls.length, 0);
  });
});

describe('middleware: finalizeResponse', () => {
  it('appends session cookies and request-context headers to a mutable response', async () => {
    config.sessionManager = () => ({ commit: () => new Headers([['set-cookie', 'a=1'], ['set-cookie', 'b=2']]) });
    const page = new Response('page', { headers: { 'x-page': 'yes' } });
    const { response } = await run('/p', { next: () => page });
    assert.equal(response, page);
    assert.deepEqual(response.headers.getSetCookie(), ['a=1', 'b=2']);
    assert.equal(response.headers.get('x-page'), 'yes');
    assert.equal(response.headers.get('powered-by'), 'Shopify, Hydrogen');
  });

  it('re-creates responses whose headers are immutable', async () => {
    config.sessionManager = () => ({ commit: () => ({ 'set-cookie': 'a=1' }) });
    const redirect = Response.redirect('https://elsewhere.example/', 302);
    assert.throws(() => redirect.headers.set('x', 'y'), TypeError);
    const { response } = await run('/p', { next: () => redirect });
    assert.notEqual(response, redirect);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://elsewhere.example/');
    assert.equal(response.headers.get('set-cookie'), 'a=1');
    assert.equal(response.headers.get('powered-by'), 'Shopify, Hydrogen');

    const fetched = Object.defineProperty(new Response('proxied'), 'headers', { value: Response.error().headers });
    const proxied = await run('/p', { next: () => fetched });
    assert.equal(proxied.response.headers.get('set-cookie'), 'a=1');
  });

  it('rethrows non-TypeError failures', async () => {
    config.sessionManager = () => ({ commit() { throw new RangeError('boom'); } });
    await assert.rejects(run('/p'), RangeError);
  });
});
