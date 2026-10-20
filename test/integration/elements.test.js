import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildFixture } from '../helpers/fixture.js';

/** The opening tag of the first element with this id. */
function tagWithId(html, id) {
  const match = html.match(new RegExp(`<[a-z-]+[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(match, `no element with id "${id}"`);
  return match[0];
}

/** The text and tag of the element with this id (no nested elements). */
function textOf(html, id) {
  const match = html.match(new RegExp(`<([a-z]+)[^>]*\\bid="${id}"[^>]*>([^<]*)</\\1>`));
  assert.ok(match, `no element with id "${id}"`);
  return match[2];
}

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

describe('elements fixture', () => {
  let site;
  before(async () => {
    site = await buildFixture('elements', { cdn: true });
  });
  after(async () => {
    await site?.dispose();
  });

  describe('<Money />', () => {
    it('formats prices for the request market', async () => {
      const us = await (await site.fetch('/product')).text();
      assert.equal(textOf(us, 'fixed'), '$1,299.00');
      assert.equal(textOf(us, 'whole'), '$1,299');
      assert.equal(textOf(us, 'bare'), '1,299.00');
      assert.match(textOf(us, 'fr'), /^1\s299,00\s€$/);

      const ca = await (await site.fetch('/en-ca/product')).text();
      assert.match(textOf(ca, 'fixed'), /^(US\$|\$)1,299\.00$/);
      assert.notEqual(textOf(ca, 'fixed'), textOf(us, 'fixed'), 'the en-CA market renders USD differently');
    });

    it('renders data attributes, the as element and pass-through attributes', async () => {
      const html = await (await site.fetch('/product')).text();
      const bare = tagWithId(html, 'bare');
      assert.ok(bare.startsWith('<strong'));
      assert.equal(attr(bare, 'class'), 'price');
      assert.equal(attr(bare, 'data-currency'), 'USD');
      assert.equal(attr(bare, 'data-amount'), '1299.00');
      assert.ok(tagWithId(html, 'price').startsWith('<span'));
    });

    it('formats a price range from Storefront data', async () => {
      const html = await (await site.fetch('/product')).text();
      const range = tagWithId(html, 'range');
      assert.ok(attr(range, 'data-amount-min'));
      assert.ok(attr(range, 'data-amount-max'));
      assert.match(textOf(html, 'range'), /\$/);
      assert.match(textOf(html, 'price'), /^(CA)?\$\d/);
    });

    it('works in a prerendered page', async () => {
      const res = await site.fetch('/prerendered');
      assert.equal(res.status, 200);
      assert.equal(textOf(await res.text(), 'price'), '$19.50');
    });
  });

  describe('<ShopifyImage />', () => {
    it('sizes Shopify images and builds a srcset', async () => {
      const html = await (await site.fetch('/product')).text();
      const cdn = tagWithId(html, 'cdn');
      const src = new URL(attr(cdn, 'src').replaceAll('&amp;', '&'));
      assert.equal(src.searchParams.get('width'), '400');
      assert.equal(src.searchParams.get('height'), '300');
      assert.equal(src.searchParams.get('crop'), 'center');
      const candidates = attr(cdn, 'srcset').replaceAll('&amp;', '&').split(', ');
      assert.equal(candidates.length, 2);
      assert.match(candidates[0], /width=200.* 200w$/);
      assert.match(candidates[1], /width=400.* 400w$/);
      assert.equal(attr(cdn, 'sizes'), '50vw');
      assert.equal(attr(cdn, 'alt'), 'Product');
      assert.equal(attr(cdn, 'loading'), 'lazy');
      assert.equal(attr(cdn, 'decoding'), 'async');
      assert.equal(attr(cdn, 'width'), '400');
      assert.equal(attr(cdn, 'height'), '300');
    });

    it('omits srcset and sizes without widths', async () => {
      const plain = tagWithId(await (await site.fetch('/product')).text(), 'plain');
      assert.equal(attr(plain, 'srcset'), undefined);
      assert.equal(attr(plain, 'sizes'), undefined);
      assert.match(plain, /\salt(=""|\s|\/?>)/);
    });

    it('leaves other hosts untouched', async () => {
      const external = tagWithId(await (await site.fetch('/product')).text(), 'external');
      assert.equal(attr(external, 'src'), 'https://example.com/a.jpg?x=1');
      assert.equal(attr(external, 'srcset'), undefined);
      assert.equal(attr(external, 'loading'), 'eager');
    });
  });

  describe('<ShopPayButton />', () => {
    let html;
    before(async () => {
      html = await (await site.fetch('/product')).text();
    });

    it('renders the custom element with a declarative shadow root', () => {
      const button = html.match(/<div id="shop-pay">([\s\S]*?)<\/div>/)[1];
      assert.match(button, /<hydrogen-shop-pay-button/);
      assert.match(button, /<template shadowrootmode="open"/);
      assert.match(button, /width:\s*100%/);
      assert.doesNotMatch(button, /<script/);
    });

    it('links variants to a same-origin cart permalink', () => {
      const button = html.match(/<div id="shop-pay">([\s\S]*?)<\/div>/)[1];
      const href = button.match(/href="(\/cart\/[^"]+)"/)?.[1];
      assert.ok(href, 'has a /cart/ href');
      assert.match(decodeURIComponent(href), /^\/cart\/\d+:2/);
    });

    it('links to /checkout without variants', () => {
      const button = html.match(/<div id="cart-pay">([\s\S]*?)<\/div>/)[1];
      assert.match(button, /href="\/checkout/);
    });

    it('renders without an href when disabled', () => {
      const button = html.match(/<div id="off">([\s\S]*?)<\/div>/)[1];
      assert.match(button, /aria-disabled="true"/);
      assert.doesNotMatch(button, /href=/);
    });

    it('is redirected by the adapter routes', async () => {
      const button = html.match(/<div id="shop-pay">([\s\S]*?)<\/div>/)[1];
      const href = button.match(/href="(\/cart\/[^"]+)"/)[1].replaceAll('&amp;', '&');
      const res = await site.fetch(href);
      assert.equal(res.status, 302);
      assert.match(res.headers.get('location'), /^https:\/\/[^/]+\/cart\/\d+:2/);

      const checkout = await site.fetch('/checkout');
      assert.equal(checkout.status, 302);
      // With no cart in the session, checkout sends the shopper back to the storefront.
      assert.ok(checkout.headers.get('location'));
    });
  });

  describe('<PredictiveSearchForm />', () => {
    let html;
    before(async () => {
      html = await (await site.fetch('/search')).text();
    });

    it('renders a GET search form with Hydrogen defaults', () => {
      const form = html.match(/<div id="default">([\s\S]*?)<\/div>/)[1];
      assert.match(form, /<form[^>]*\saction="\/search"/);
      assert.match(form, /<form[^>]*\smethod="get"/);
      assert.match(form, /<form[^>]*\srole="search"/);
      const input = form.match(/<input[^>]*>/)[0];
      assert.equal(attr(input, 'name'), 'q');
      assert.equal(attr(input, 'type'), 'search');
      assert.equal(attr(input, 'autocomplete'), 'off');
      assert.equal(attr(input, 'aria-label'), 'Search');
      assert.equal(attr(input, 'value'), undefined);
      assert.match(form, /<button type="submit">Go<\/button>/);
    });

    it('accepts action, placeholder, label, value and attributes', () => {
      const form = html.match(/<div id="custom">([\s\S]*?)<\/div>/)[1];
      assert.match(form, /<form[^>]*\saction="\/en-ca\/search"/);
      assert.match(form, /<form[^>]*\sclass="f"/);
      const input = form.match(/<input[^>]*>/)[0];
      assert.equal(attr(input, 'placeholder'), 'Find it');
      assert.equal(attr(input, 'aria-label'), 'Find products');
      assert.equal(attr(input, 'value'), 'socks');
      assert.equal(attr(input, 'id'), 'q');
    });

    it('prefills the term from the URL', async () => {
      const res = await site.fetch('/search?q=hat%20%22band%22');
      const form = (await res.text()).match(/<div id="default">([\s\S]*?)<\/div>/)[1];
      assert.equal(attr(form.match(/<input[^>]*>/)[0], 'value'), 'hat &quot;band&quot;');
    });
  });
});
