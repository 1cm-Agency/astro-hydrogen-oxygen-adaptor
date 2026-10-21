import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildFixture, ORIGIN } from '../helpers/fixture.js';

// Needs network access to mock.shop (the default store); `slides` has one option, Size.
const text = async (response) => (await response.text()).replaceAll('&#34;', '"').replaceAll('&amp;', '&');
const variantOf = (html) => html.match(/<p id="selected-variant">([^<]+)<\/p>/)?.[1];
const titleOf = (html) => html.match(/<p id="selected-title">([^<]*)<\/p>/)?.[1];
const optionHref = (html, value) =>
  html.match(new RegExp(`<a href="([^"]+)"[^>]*data-option-value="${value}"`))?.[1];

describe('cart-elements fixture', () => {
  let site;
  before(async () => {
    site = await buildFixture('cart-elements', { cdn: true });
  });
  after(() => site?.dispose());

  const post = (path, fields, headers = {}) =>
    site.fetch('/api/cart', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: ORIGIN,
        referer: `${ORIGIN}${path}`,
        ...headers,
      },
      body: new URLSearchParams(fields).toString(),
    });

  it('renders option links with query-string URLs and an add form posting to /api/cart', async () => {
    const res = await site.fetch('/products/slides');
    assert.equal(res.status, 200);
    const html = await text(res);
    assert.match(html, /<fieldset data-option="Size"/);
    assert.ok(optionHref(html, 'Small')?.startsWith('/products/slides?Size=Small') || optionHref(html, 'Small')?.startsWith('?Size=Small'));
    assert.match(html, /aria-current="true"/);
    assert.match(html, /<form method="post" action="\/api\/cart"[^>]*data-cart-form/);
    assert.match(html, /name="merchandiseId" value="gid:\/\/shopify\/ProductVariant\/\d+"/);
    assert.match(html, /name="intent" value="add"/);
    assert.match(html, /data-product-quantity/);
  });

  it('selects the variant named by the option link', async () => {
    const first = await text(await site.fetch('/products/slides'));
    const href = optionHref(first, 'Large');
    assert.ok(href, 'a Large link exists');
    const next = await text(await site.fetch(href.startsWith('?') ? `/products/slides${href}` : href));
    assert.equal(titleOf(next), 'Large');
    assert.notEqual(variantOf(next), variantOf(await text(await site.fetch('/products/slides?Size=Small'))));
    assert.match(next, /data-option-value="Large"[^>]*data-selected|data-selected[^>]*data-option-value="Large"/);
  });

  it('adds with a plain form post, shows the line in /cart, and removes it', async () => {
    const html = await text(await site.fetch('/products/slides?Size=Medium'));
    const merchandiseId = html.match(/name="merchandiseId" value="([^"]+)"/)[1];
    const add = await post('/products/slides?Size=Medium', { intent: 'add', merchandiseId, quantity: '2' });
    assert.equal(add.status, 303);
    const back = new URL(add.headers.get('location'), ORIGIN);
    assert.equal(back.pathname + back.search, '/products/slides?Size=Medium');
    const cookie = add.headers.get('set-cookie')?.split(';')[0];
    assert.match(cookie ?? '', /^cart=/);

    const cart = await text(await site.fetch('/cart', { headers: { cookie } }));
    assert.match(cart, /Slides \(Medium\)/);
    assert.match(cart, /name="intent" value="set"/);
    assert.match(cart, /name="quantity" value="2"/);
    assert.match(cart, /name="intent" value="remove"/);
    const lineId = cart.match(/name="lineId" value="([^"]+)"/)[1];

    const set = await post('/cart', { intent: 'set', lineId, quantity: '3' }, { cookie });
    assert.equal(set.status, 303);
    assert.match(await text(await site.fetch('/cart', { headers: { cookie } })), /name="quantity" value="3"/);

    const remove = await post('/cart', { intent: 'remove', lineId }, { cookie });
    assert.equal(remove.status, 303);
    assert.match(await text(await site.fetch('/cart', { headers: { cookie } })), /id="empty"/);
  });

  it('renders a bare CartForm with hidden fields and a default button', async () => {
    const html = await text(await site.fetch('/bare?enhance=0'));
    assert.match(html, /<form method="post" action="\/api\/cart" data-cart-action="add" id="bare">/);
    assert.match(html, /name="merchandiseId" value="gid:\/\/shopify\/ProductVariant\/1"/);
    assert.match(html, /name="quantity" value="2"/);
    assert.match(html, /<button name="intent" value="add">Buy now<\/button>/);
    assert.match(html, /name="note" value="hello"/);
    assert.match(html, /name="discountCode" value="SAVE"/);
    assert.match(html, /<button name="intent" value="discount-apply">Apply<\/button>/);
  });

  it('renders no script and no data-cart-form when enhance is false', async () => {
    for (const path of ['/bare?enhance=0', '/products/slides?plain']) {
      const html = await text(await site.fetch(path));
      assert.doesNotMatch(html, /<script/, path);
      assert.doesNotMatch(html, /data-cart-form/, path);
    }
  });

  it('loads the client modules and marks forms when enhance is on', async () => {
    const bare = await text(await site.fetch('/bare'));
    assert.match(bare, /data-cart-form/);
    assert.match(bare, /<script type="module"/);
    const product = await text(await site.fetch('/products/slides'));
    assert.match(product, /data-cart-form/);
    assert.match(product, /<script type="module"/);
    assert.match(product, /<script type="application\/json" data-product-form-data>/);
  });
});
