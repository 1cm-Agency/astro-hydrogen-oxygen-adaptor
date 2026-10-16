import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { getOxygenBuyer } from '../dist/runtime/buyer.js';
import { resolveShopifyScripts, serializeForScript } from '../dist/runtime/shopify-scripts.js';

describe('getOxygenBuyer', () => {
  it('parses Oxygen geolocation headers into typed fields', () => {
    const buyer = getOxygenBuyer(
      new Headers({
        'oxygen-buyer-country': 'US',
        'oxygen-buyer-region': 'California',
        'oxygen-buyer-region-code': 'CA',
        'oxygen-buyer-city': 'San Francisco',
        'oxygen-buyer-postal-code': '94105',
        'oxygen-buyer-continent': 'NA',
        'oxygen-buyer-latitude': '37.78855',
        'oxygen-buyer-longitude': '-122.40140',
        'oxygen-buyer-timezone': 'America/Los_Angeles',
        'oxygen-buyer-metro-code': '807',
        'oxygen-buyer-is-eu-country': '',
      }),
      '203.0.113.7',
    );
    assert.deepEqual(buyer, {
      ip: '203.0.113.7',
      country: 'US',
      region: 'California',
      regionCode: 'CA',
      city: 'San Francisco',
      postalCode: '94105',
      continent: 'NA',
      latitude: 37.78855,
      longitude: -122.4014,
      timezone: 'America/Los_Angeles',
      metroCode: '807',
      isEuCountry: false,
    });
  });

  it('leaves out missing or malformed values', () => {
    const buyer = getOxygenBuyer(
      new Headers({ 'oxygen-buyer-is-eu-country': 'true', 'oxygen-buyer-latitude': 'nope', 'oxygen-buyer-city': ' ' }),
      undefined,
    );
    assert.deepEqual(buyer, { isEuCountry: true });
  });
});

describe('resolveShopifyScripts', () => {
  afterEach(() => mock.restoreAll());

  const locals = (env, i18n = { country: 'CA', language: 'FR', pathPrefix: '/fr-ca' }) => ({
    oxygen: { env },
    shopifyRequestContext: { i18n },
  });
  const env = { SHOP_ID: '123', PUBLIC_STORE_DOMAIN: 'shop.myshopify.com', PUBLIC_STOREFRONT_ID: '456' };

  it('renders tags from env and the request market, and starts the scripts by default', () => {
    const result = resolveShopifyScripts({ locals: locals(env), props: { consent: { mode: 'default-banner' } } });
    const html = result.tags.join('');
    assert.match(html, /<script/);
    assert.match(html, /123/);
    assert.match(html, /shop\.myshopify\.com/);
    assert.match(html, /"country":"CA"|country.{0,4}CA/i);
    assert.deepEqual(result.init, { consent: { mode: 'default-banner' } });
  });

  it('lets props override env and market, and skips browser init when asked', () => {
    const result = resolveShopifyScripts({
      locals: locals(env),
      routeTemplates: { product: '/p/:productHandle' },
      props: { shop: { shopId: '999' }, i18n: { currency: 'cad' }, initialize: false },
    });
    assert.match(result.tags.join(''), /999/);
    assert.equal(result.init, undefined);
  });

  it('passes route templates and webMcp to browser init', () => {
    const routes = { product: '/p/:productHandle' };
    const result = resolveShopifyScripts({ locals: locals(env), routeTemplates: routes, props: { webMcp: false } });
    assert.deepEqual(result.init, { routes, webMcp: false });
  });

  it('renders nothing, with one warning, without a shop ID (mock.shop)', () => {
    const warn = mock.method(console, 'warn', () => {});
    assert.equal(resolveShopifyScripts({ locals: locals({}), props: {} }), undefined);
    assert.equal(resolveShopifyScripts({ locals: locals({}), props: {} }), undefined);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(warn.mock.calls[0].arguments[0], /SHOP_ID and PUBLIC_STORE_DOMAIN/);
  });
});

describe('serializeForScript', () => {
  it('cannot close the surrounding script tag', () => {
    const json = serializeForScript({ a: '</script><script>alert(1)</script>' });
    assert.ok(!json.includes('</script'));
    assert.deepEqual(JSON.parse(json), { a: '</script><script>alert(1)</script>' });
  });
});
