import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isShopifyImageHost, shopifyImageSrcSet, shopifyImageUrl } from '../dist/runtime/image.js';

const CDN = 'https://cdn.shopify.com/s/files/1/0/products/a.jpg?v=123';

describe('isShopifyImageHost', () => {
  it('matches Shopify hosts and their subdomains only', () => {
    assert.equal(isShopifyImageHost('cdn.shopify.com'), true);
    assert.equal(isShopifyImageHost('mock.shop'), true);
    assert.equal(isShopifyImageHost('CDN.Shopify.com'), true);
    assert.equal(isShopifyImageHost('images.mock.shop'), true);
    assert.equal(isShopifyImageHost('example.com'), false);
    assert.equal(isShopifyImageHost('evilmock.shop'), false);
    assert.equal(isShopifyImageHost('cdn.shopify.com.evil.test'), false);
  });
});

describe('shopifyImageUrl', () => {
  it('adds width, height and crop and keeps existing parameters', () => {
    const url = new URL(shopifyImageUrl(CDN, { width: 400, height: 300, crop: 'center' }));
    assert.equal(url.searchParams.get('v'), '123');
    assert.equal(url.searchParams.get('width'), '400');
    assert.equal(url.searchParams.get('height'), '300');
    assert.equal(url.searchParams.get('crop'), 'center');
  });

  it('replaces existing sizing parameters', () => {
    const url = new URL(shopifyImageUrl(`${CDN}&width=50`, { width: 200 }));
    assert.deepEqual(url.searchParams.getAll('width'), ['200']);
  });

  it('only sets the options it is given', () => {
    assert.equal(new URL(shopifyImageUrl(CDN, { width: 10 })).searchParams.has('height'), false);
  });

  it('returns other hosts and invalid URLs unchanged', () => {
    assert.equal(shopifyImageUrl('https://example.com/a.jpg', { width: 400 }), 'https://example.com/a.jpg');
    assert.equal(shopifyImageUrl('/local/a.jpg', { width: 400 }), '/local/a.jpg');
    assert.equal(shopifyImageUrl('', { width: 400 }), '');
  });
});

describe('shopifyImageSrcSet', () => {
  it('builds one candidate per width', () => {
    const srcset = shopifyImageSrcSet(CDN, { widths: [200, 400], height: 100, crop: 'top' });
    const candidates = srcset.split(', ');
    assert.equal(candidates.length, 2);
    assert.match(candidates[0], / 200w$/);
    for (const part of ['width=200', 'height=100', 'crop=top']) assert.ok(candidates[0].includes(part), part);
    assert.ok(candidates[1].endsWith(' 400w'));
  });

  it('has default widths', () => {
    assert.equal(shopifyImageSrcSet(CDN).split(', ').length, 3);
  });

  it('is empty for other hosts and invalid URLs', () => {
    assert.equal(shopifyImageSrcSet('https://example.com/a.jpg'), '');
    assert.equal(shopifyImageSrcSet('nope'), '');
  });
});
