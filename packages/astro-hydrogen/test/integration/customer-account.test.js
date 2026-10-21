import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildFixture, ORIGIN } from '../helpers/fixture.js';
import { textById } from '../helpers/html.js';

// Fake values: login redirects to shopify.com without any network call until the OAuth callback.
const ENV = {
  SESSION_SECRET: 'integration-test-secret-of-reasonable-length',
  SHOP_ID: '12345',
  PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID: 'shp_fixture_client',
};
const HTTPS = { 'x-forwarded-proto': 'https' };

describe('customer-account fixture', () => {
  let site;
  let noSecret;
  before(async () => {
    site = await buildFixture('customer-account', { env: ENV });
    noSecret = await buildFixture('customer-account', { env: { ...ENV, SESSION_SECRET: '' } });
  });
  after(async () => {
    await site?.dispose();
    await noSecret?.dispose();
  });

  it('redirects /account/login to Shopify and sets the __Host-session cookie', async () => {
    const res = await site.fetch('/account/login', { headers: HTTPS });
    assert.ok([302, 303].includes(res.status), String(res.status));
    const location = new URL(res.headers.get('location'));
    assert.equal(location.origin, 'https://shopify.com');
    assert.match(location.pathname, /^\/authentication\/12345\//);
    assert.equal(location.searchParams.get('client_id'), 'shp_fixture_client');
    assert.equal(location.searchParams.get('redirect_uri'), 'https://shop.test/account/authorize');
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /^__Host-session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
  });

  it('only accepts POST on /account/logout', async () => {
    assert.equal((await site.fetch('/account/logout', { headers: HTTPS })).status, 405);
  });

  it('rejects a cross-site POST /account/logout without an Origin header', async () => {
    const res = await site.fetch('/account/logout', { method: 'POST', headers: HTTPS });
    assert.equal(res.status, 403);
  });

  it('accepts a same-origin POST /account/logout', async () => {
    const res = await site.fetch('/account/logout', {
      method: 'POST',
      headers: { ...HTTPS, origin: 'https://shop.test' },
    });
    assert.ok([302, 303].includes(res.status), String(res.status));
  });

  it('reports a visitor as logged out', async () => {
    const res = await site.fetch('/whoami', { headers: HTTPS });
    assert.equal(res.status, 200);
    assert.equal(textById(await res.text(), 'logged-in'), 'false');
  });

  it('fails with an error naming SESSION_SECRET when it is not set', async () => {
    const res = await noSecret.fetch('/', { headers: HTTPS });
    assert.equal(res.status, 500);
    // Astro turns the middleware error into an empty 500; the cause goes to the Worker's console.
    assert.equal(await res.text(), '');
    await noSecret.waitForLog(/SESSION_SECRET is not set/);
  });
});

void ORIGIN;
