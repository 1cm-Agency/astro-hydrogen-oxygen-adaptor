import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildFixture } from '../helpers/fixture.js';
import { jsonById, textById } from '../helpers/html.js';

describe('hydrogen-config fixture', () => {
  let site;
  before(async () => {
    site = await buildFixture('hydrogen-config');
  });
  after(() => site?.dispose());

  it('derives i18n from the URL with a function', async () => {
    const us = jsonById(await (await site.fetch('/')).text(), 'i18n');
    assert.deepEqual(us, { country: 'US', language: 'EN', pathPrefix: '' }); // Hydrogen normalizes the prefix
    const ca = jsonById(await (await site.fetch('/en-ca')).text(), 'i18n');
    assert.deepEqual(ca, { country: 'CA', language: 'EN', pathPrefix: '/en-ca' });
  });

  it('uses the custom storefront factory that wraps the default client', async () => {
    const html = await (await site.fetch('/')).text();
    assert.equal(textById(html, 'custom-factory'), 'true');
  });

  it('uses the custom getBuyerIp', async () => {
    const html = await (
      await site.fetch('/', { headers: { 'x-real-ip': '198.51.100.7', 'oxygen-buyer-ip': '203.0.113.9' } })
    ).text();
    assert.equal(jsonById(html, 'buyer').ip, '198.51.100.7');
  });

  it('serves a handler group added through handlers({ defaults })', async () => {
    const res = await site.fetch('/api/ping');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal((await site.fetch('/api/ping', { method: 'POST' })).status, 405, 'registered for GET only');
  });

  it('keeps the default cart handlers', async () => {
    assert.deepEqual(await (await site.fetch('/api/cart')).json(), { cart: null });
  });

  it('skips Shopify redirects with shopifyRedirects: false', async () => {
    const res = await site.fetch('/admin');
    assert.equal(res.status, 404);
  });

  // Hydrogen redirects `?variant=<numeric id>` only on URLs matching a `product` route template:
  // here /p/:productHandle. An unknown variant is redirected to the same URL without `variant`
  // (one lookup against mock.shop; with the network down the lookup also resolves to "unknown").
  it('redirects ?variant= on the custom product route template', async () => {
    const res = await site.fetch('/p/some-handle?variant=123&ref=ad');
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get('location'));
    assert.equal(location.pathname, '/p/some-handle');
    assert.equal(location.searchParams.has('variant'), false);
    assert.equal(location.searchParams.get('ref'), 'ad');
  });

  it('also redirects ?variant= on the standard /products/ path (Hydrogen keeps matching it)', async () => {
    const res = await site.fetch('/products/some-handle?variant=123');
    assert.equal(res.status, 302);
    assert.equal(new URL(res.headers.get('location')).pathname, '/products/some-handle');
  });
});
