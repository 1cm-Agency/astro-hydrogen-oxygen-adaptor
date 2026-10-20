import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildFixture } from '../helpers/fixture.js';
import { textById } from '../helpers/html.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const renders = (site, page) => [...site.logs.matchAll(new RegExp(`render ${page} \\d+`, 'g'))].length;

describe('route cache on the Oxygen Cache API', () => {
  let site;
  before(async () => {
    site = await buildFixture('route-cache');
  });
  after(() => site?.dispose());

  it('serves the second request from the cache', async () => {
    const first = await site.fetch('/');
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-astro-cache'), 'MISS');
    const firstNow = textById(await first.text(), 'now');
    await site.waitForLog(/render index \d+/);

    await sleep(30); // the store runs through waitUntil
    const second = await site.fetch('/');
    assert.equal(second.headers.get('x-astro-cache'), 'HIT');
    assert.equal(textById(await second.text(), 'now'), firstNow);
    assert.equal(renders(site, 'index'), 1, 'the page rendered once');
    assert.equal(second.headers.get('cdn-cache-control'), null);
  });

  it('renders again after the tag is invalidated', async () => {
    const before = textById(await (await site.fetch('/')).text(), 'now');
    await sleep(5);
    assert.equal(await (await site.fetch('/api/invalidate?tag=t1')).text(), 'invalidated');
    const res = await site.fetch('/');
    assert.equal(res.headers.get('x-astro-cache'), 'MISS');
    assert.notEqual(textById(await res.text(), 'now'), before);
  });

  it('serves stale within the SWR window and refreshes in the background', async () => {
    const first = textById(await (await site.fetch('/short')).text(), 'now');
    await sleep(1300); // past maxAge (1s), inside swr
    const stale = await site.fetch('/short');
    assert.equal(stale.headers.get('x-astro-cache'), 'STALE');
    assert.equal(textById(await stale.text(), 'now'), first);
    await site.waitForLog(/render short \d+[\s\S]*render short \d+/);
    await sleep(100);
    const fresh = await site.fetch('/short');
    assert.equal(fresh.headers.get('x-astro-cache'), 'HIT');
    assert.notEqual(textById(await fresh.text(), 'now'), first);
  });

  it('never caches a page that sets a cookie', async () => {
    const first = await site.fetch('/cookie');
    assert.match(first.headers.get('set-cookie') ?? '', /visitor=yes/);
    await sleep(30);
    const second = await site.fetch('/cookie');
    assert.match(second.headers.get('set-cookie') ?? '', /visitor=yes/);
    assert.notEqual(second.headers.get('x-astro-cache'), 'HIT');
    assert.equal(renders(site, 'cookie'), 2);
  });
});
