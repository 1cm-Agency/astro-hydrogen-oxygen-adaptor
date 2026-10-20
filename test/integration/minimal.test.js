import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildFixture } from '../helpers/fixture.js';
import { jsonById } from '../helpers/html.js';

describe('minimal fixture in CDN mode', () => {
  let site;
  before(async () => {
    site = await buildFixture('minimal', { cdn: true });
  });
  after(() => site?.dispose());

  it('server-renders with a public client and the MiniOxygen default buyer', async () => {
    const res = await site.fetch('/');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<p id="type">public<\/p>/);
    assert.match(html, /<p id="has-oxygen">true<\/p>/);
    const buyer = jsonById(html, 'buyer');
    assert.equal(buyer.country, 'US');
    assert.equal(buyer.isEuCountry, false);
  });

  it('reflects buyer headers in locals.buyer and clientAddress', async () => {
    const res = await site.fetch('/api/info', {
      headers: { 'oxygen-buyer-is-eu-country': '1', 'oxygen-buyer-ip': '203.0.113.9, 10.0.0.1', 'oxygen-buyer-country': 'DE' },
    });
    assert.equal(res.status, 200);
    const info = await res.json();
    assert.equal(info.clientAddress, '203.0.113.9');
    assert.equal(info.buyer.ip, '203.0.113.9');
    assert.equal(info.buyer.isEuCountry, true);
    assert.equal(info.buyer.country, 'DE');
  });

  it('exposes the Worker bindings as locals.oxygen.env and runs in workerd', async () => {
    const info = await (await site.fetch('/api/info')).json();
    assert.ok(Array.isArray(info.envKeys));
    assert.equal(info.userAgent, 'Cloudflare-Workers');
  });

  it('runs the adapter middleware before the user middleware, and the user middleware still runs', async () => {
    const res = await site.fetch('/');
    assert.equal(res.headers.get('x-user-middleware'), 'object', 'the Storefront client was already on locals');
  });

  it('serves prerendered pages from the asset CDN', async () => {
    const res = await site.fetch('/static');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /<h1>prerendered<\/h1>/);
  });

  it('answers HEAD for a prerendered page without a body', async () => {
    const res = await site.fetch('/static', { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
  });

  it('skips the prerender lookup for the Worker\'s own asset subrequests', async () => {
    const res = await site.fetch('/static', { headers: { 'x-astro-hydrogen-asset': '1' } });
    assert.equal(res.status, 404, 'a request marked as an asset subrequest never recurses into the CDN lookup');
  });

  it('serves Hydrogen routes before Astro routing', async () => {
    const res = await site.fetch('/api/cart');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { cart: null });
  });

  it('redirects /admin to the store admin after Astro 404s', async () => {
    const res = await site.fetch('/admin');
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), 'https://mock.shop/admin');
  });

  it('renders the custom 404 page for unknown paths', async () => {
    const res = await site.fetch('/no-such-page');
    assert.equal(res.status, 404);
    assert.match(await res.text(), /custom-404/);
  });

  it('falls back at runtime when a dependency imports a node: module dynamically', async () => {
    const res = await site.fetch('/crypto-fallback');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<p id="crypto">fallback<\/p>/);
  });
});

describe('minimal fixture without a CDN', () => {
  let site;
  before(async () => {
    site = await buildFixture('minimal');
  });
  after(() => site?.dispose());

  it('still server-renders and serves Hydrogen routes', async () => {
    assert.equal((await site.fetch('/')).status, 200);
    assert.deepEqual(await (await site.fetch('/api/cart')).json(), { cart: null });
  });

  // Documented limitation: without HYDROGEN_ASSET_BASE_URL the Worker looks for prerendered HTML on
  // its own origin, and a bare MiniOxygen has no origin asset server, so the page is not found.
  // `astro preview` and Oxygen both provide one.
  it('cannot find prerendered pages (no origin asset server)', async () => {
    assert.equal((await site.fetch('/static')).status, 404);
  });
});
