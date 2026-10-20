import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildFixture } from '../helpers/fixture.js';

describe('shopify-scripts fixture', () => {
  let configured;
  let bare;
  before(async () => {
    configured = await buildFixture('shopify-scripts', {
      env: { SHOP_ID: '12345', PUBLIC_STORE_DOMAIN: 'fixture.myshopify.com', PUBLIC_STOREFRONT_ID: '67890' },
    });
    bare = await buildFixture('shopify-scripts');
  });
  after(async () => {
    await configured?.dispose();
    await bare?.dispose();
  });

  it('renders the Shopify script tags and the init JSON in the head', async () => {
    const res = await configured.fetch('/');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<head>[\s\S]*<script[^>]+src="[^"]*cdn\.shopify\.com[^"]*"/);
    assert.match(html, /<script type="application\/json" data-astro-hydrogen-shopify-scripts[^>]*>\{[^<]*\}<\/script>/);
    assert.ok(html.includes('12345') || html.includes('67890'), 'shop identifiers are in the tags');
  });

  it('renders nothing without SHOP_ID and PUBLIC_STORE_DOMAIN', async () => {
    const res = await bare.fetch('/');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.doesNotMatch(html, /data-astro-hydrogen-shopify-scripts/);
    assert.doesNotMatch(html, /cdn\.shopify\.com/);
    await bare.waitForLog(/<ShopifyScripts \/> rendered nothing: SHOP_ID and PUBLIC_STORE_DOMAIN not set/);
  });
});
