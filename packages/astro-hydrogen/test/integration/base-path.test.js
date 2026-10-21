import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { preview } from 'astro';
import { buildFixture, freePort } from '../helpers/fixture.js';

describe('base-path fixture (base: "/shop")', () => {
  let site;
  before(async () => {
    site = await buildFixture('base-path', { cdn: true });
  });
  after(() => site?.dispose());

  it('serves the prerendered index at /shop/ and /shop', async () => {
    for (const path of ['/shop/', '/shop']) {
      const res = await site.fetch(path);
      assert.equal(res.status, 200, path);
      assert.match(await res.text(), /base-index/, path);
    }
  });

  it('serves an on-demand page under the base', async () => {
    const res = await site.fetch('/shop/dynamic');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<p id="type">public<\/p>/);
  });

  it('404s for unknown paths under the base', async () => {
    assert.equal((await site.fetch('/shop/nope')).status, 404);
  });
});

// Regression for the phase 1 base-path fix: `astro preview` serves the client directory under `base`.
describe('base-path fixture through astro preview()', () => {
  let server;
  let origin;
  before(async () => {
    const built = await buildFixture('base-path'); // plain build: preview supplies the origin asset server
    await built.dispose();
    const port = await freePort();
    server = await preview({
      root: built.root,
      outDir: built.dist.slice(built.root.length + 1),
      server: { port, host: '127.0.0.1' },
      logLevel: 'error',
    });
    origin = `http://127.0.0.1:${port}`;
  });
  after(() => server?.stop());

  it('serves /shop/ (prerendered) with 200', async () => {
    const res = await fetch(`${origin}/shop/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /base-index/);
  });

  it('serves /shop/dynamic (on demand) with 200', async () => {
    const res = await fetch(`${origin}/shop/dynamic`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /base-dynamic/);
  });
});
