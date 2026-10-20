import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildFixture } from '../helpers/fixture.js';

const titles = (html, id) =>
  [...(html.match(new RegExp(`<ul id="${id}">([\\s\\S]*?)</ul>`))?.[1] ?? '').matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, '').trim(),
  );

describe('content fixture (against mock.shop)', () => {
  let site;
  before(async () => {
    site = await buildFixture('content', { cdn: true });
  });
  after(async () => {
    await site?.dispose();
  });

  describe('build-time loader', () => {
    it('prerenders the collections', async () => {
      const html = await (await site.fetch('/')).text();
      const products = titles(html, 'products');
      assert.ok(products.length > 0 && products.length <= 10, `got ${products.length} products`);
      assert.ok(products.includes('Slides'), products.join(', '));
      assert.ok(titles(html, 'pages').includes('Liquid'));
      assert.equal(titles(html, 'articles').length, 3, 'max: 3 across pages of 2');
    });

    it('renders an entry with <Content />', async () => {
      const res = await site.fetch('/pages/liquid');
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /<h1>Liquid<\/h1>/);
      assert.match(html.match(/<main id="body">([\s\S]*?)<\/main>/)[1], /<p>|<h\d|<div/);
    });
  });

  describe('live loader', () => {
    it('serves collections and entries at request time', async () => {
      const res = await site.fetch('/live');
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.equal(titles(html, 'products').length, 3);
      assert.match(html, /<h1 id="entry">Slides<\/h1>/);
      assert.match(html, /<div id="entry-html">.+<\/div>/);
      assert.equal(html.match(/<p id="error">([^<]*)</)[1], '');
    });

    it('returns a cache hint with tags, lastModified and maxAge', async () => {
      const html = await (await site.fetch('/live')).text();
      const hint = JSON.parse(html.match(/<pre id="hint">([^<]*)<\/pre>/)[1].replaceAll('&quot;', '"'));
      assert.ok(hint.tags.includes('shopify:products'));
      assert.ok(hint.tags.some((tag) => tag.startsWith('gid://shopify/Product/')), 'entry tags are merged in');
      assert.ok(Number.isFinite(Date.parse(hint.lastModified)));
      const entryHint = JSON.parse(html.match(/<pre id="entry-hint">([^<]*)<\/pre>/)[1].replaceAll('&quot;', '"'));
      assert.ok(entryHint.tags.includes('shopify:products'));
    });

    it('uses the market from the filter', async () => {
      const res = await site.fetch('/live-market');
      assert.equal(res.status, 200);
      assert.equal(titles(await res.text(), 'products').length, 3);
    });

    it('yields no entry, not a server error, for an unknown handle', async () => {
      const res = await site.fetch('/live-missing');
      assert.equal(res.status, 404);
      const html = await res.text();
      assert.match(html, /<p id="entry">none<\/p>/);
      assert.match(html, /<p id="error">LiveEntryNotFoundError<\/p>/);
    });

    it('reads through the sub-request cache', async () => {
      const html = await (await site.fetch('/live-cache')).text();
      const counts = JSON.parse(html.match(/<pre id="counts">([^<]*)<\/pre>/)[1].replaceAll('&quot;', '"'));
      assert.equal(html.match(/<p id="size">(\d+)</)[1], '2');
      assert.match(html, /<p id="same">true<\/p>/);
      assert.equal(counts.firstRequests, 1, `the count must see the first request: ${JSON.stringify(counts)}`);
      assert.equal(counts.secondRequests, 0, `the repeat within the cache window made a Storefront request: ${JSON.stringify(counts)}`);
    });

    it('serves a repeat request', async () => {
      const first = await (await site.fetch('/live')).text();
      const second = await (await site.fetch('/live')).text();
      assert.deepEqual(titles(second, 'products'), titles(first, 'products'));
    });
  });
})
