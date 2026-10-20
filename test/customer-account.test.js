/**
 * Runs the real middleware against Hydrogen's real Customer Account handlers. The middleware
 * imports `virtual:astro-hydrogen/config`, which only Vite resolves, so a loader hook maps that
 * id to a module re-exporting `globalThis.__hydrogenTestConfig`.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { register } from 'node:module';

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

const ENV = {
  SHOP_ID: '12345',
  PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID: 'shp_client',
  SESSION_SECRET: 'a-test-secret-of-reasonable-length',
  PUBLIC_STORE_DOMAIN: 'mock.shop',
};

let onRequest;
const fetchCalls = [];
before(async () => {
  // Never touch the network: the token exchange (reached only if the OAuth state survived) fails.
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    return new Response('{"error":"invalid_grant"}', { status: 400, headers: { 'content-type': 'application/json' } });
  };
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
  globalThis.__hydrogenTestConfig = { customerAccount: true };
  ({ onRequest } = await import('../dist/entrypoints/middleware.js'));
});

function run(path, { env = ENV, method = 'GET', headers } = {}) {
  const url = new URL(path, 'https://shop.example');
  const request = new Request(url, { method, headers, redirect: 'manual' });
  const locals = { oxygen: { env, waitUntil() {}, cache: undefined } };
  let nextCalled = false;
  const result = onRequest({ request, url, locals, isPrerendered: false }, async () => {
    nextCalled = true;
    return new Response('page');
  });
  return result.then((response) => ({ response, locals, nextCalled }));
}

describe('customerAccount middleware', () => {
  it('serves /account/login with a redirect to Shopify and a session cookie', async () => {
    const { response, nextCalled } = await run('/account/login?return_to=/account/orders');
    assert.equal(nextCalled, false);
    assert.ok([302, 303].includes(response.status), String(response.status));
    const location = new URL(response.headers.get('location'));
    assert.equal(location.hostname, 'shopify.com');
    assert.match(location.pathname, /^\/authentication\/12345\//);
    assert.equal(location.searchParams.get('client_id'), 'shp_client');
    assert.equal(location.searchParams.get('redirect_uri'), 'https://shop.example/account/authorize');
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /^__Host-session=/);
    assert.ok(cookie.includes('HttpOnly') && cookie.includes('Secure'));
  });

  it('keeps the OAuth state across requests via the cookie', async () => {
    const login = await run('/account/login');
    const cookie = login.response.headers.get('set-cookie').split(';')[0];
    const state = new URL(login.response.headers.get('location')).searchParams.get('state');
    // With the cookie the callback finds the pending login and reaches the token exchange;
    // without it (what a per-request in-memory session produces) it fails first.
    fetchCalls.length = 0;
    const withoutCookie = await run(`/account/authorize?code=abc&state=${state}`);
    assert.equal(fetchCalls.length, 0, 'no pending login without the cookie');
    const withCookie = await run(`/account/authorize?code=abc&state=${state}`, { headers: { cookie } });
    assert.equal(fetchCalls.length, 1, 'token exchange attempted with the cookie');
    assert.match(fetchCalls[0], /^https:\/\/shopify\.com\/authentication\/12345\//);
    for (const r of [withCookie, withoutCookie]) assert.match(r.response.headers.get('location'), /login=failed/);
  });

  it('rejects GET logout (405) and cross-origin POST logout (403)', async () => {
    assert.equal((await run('/account/logout')).response.status, 405);
    assert.equal((await run('/account/logout', { method: 'POST' })).response.status, 403);
    const ok = await run('/account/logout', { method: 'POST', headers: { origin: 'https://shop.example' } });
    assert.ok([302, 303].includes(ok.response.status));
  });

  it('exposes customerSession and customerAccount on locals', async () => {
    const { locals, response } = await run('/anything');
    assert.equal(response.status, 200);
    assert.equal(typeof locals.customerSession.isLoggedIn, 'function');
    assert.equal(locals.customerAccount.apiUrl, 'https://shopify.com/12345/account/customer/api/2026-10/graphql');
    assert.equal(await locals.customerSession.isLoggedIn(locals.shopifySession, locals.shopifyRequestContext), false);
  });

  it('names the missing env var and the env pull command', async () => {
    for (const name of ['SHOP_ID', 'PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID', 'SESSION_SECRET']) {
      const env = { ...ENV, [name]: undefined };
      await assert.rejects(run('/account/login', { env }), (error) => {
        assert.ok(error.message.includes(name), error.message);
        assert.ok(error.message.includes('shopify hydrogen env pull'));
        return true;
      });
    }
  });
});
