import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { dev } from 'astro';
import { buildFixture, DEV_PORT_RANGE, freePort, pathOf } from '../helpers/fixture.js';

describe('prerendered-404 fixture', () => {
  let site;
  before(async () => {
    site = await buildFixture('prerendered-404', { cdn: true });
  });
  after(() => site?.dispose());

  it('serves the prerendered 404 page for unknown paths', async () => {
    const res = await site.fetch('/no-such-page');
    assert.equal(res.status, 404);
    assert.match(await res.text(), /prerendered-404/);
  });

  // Astro renders unmatched URLs from the static 404 page without running middleware, so the Worker
  // entry runs Hydrogen's routes and redirects itself for them.
  it('serves Hydrogen routes even though the 404 page is prerendered', async () => {
    assert.deepEqual(await (await site.fetch('/api/cart')).json(), { cart: null });
  });

  it('redirects /admin even though the 404 page is prerendered', async () => {
    const res = await site.fetch('/admin');
    assert.equal(res.status, 301);
  });
});

// In dev, Astro matches unmatched URLs to the 404 route, whose middleware pass is a prerendered one
// (no Hydrogen routes), so the Worker entry handles them too.
describe('prerendered-404 fixture under astro dev', () => {
  let server;
  let origin;
  before(async () => {
    const port = await freePort(DEV_PORT_RANGE);
    server = await dev({ root: pathOf('prerendered-404'), server: { port, host: '127.0.0.1' }, logLevel: 'error' });
    origin = `http://127.0.0.1:${port}`;
  });
  after(() => server?.stop());

  it('serves Hydrogen routes and redirects', async () => {
    assert.deepEqual(await (await fetch(`${origin}/api/cart`)).json(), { cart: null });
    const admin = await fetch(`${origin}/admin`, { redirect: 'manual' });
    assert.equal(admin.status, 301);
    assert.equal(admin.headers.get('location'), 'https://mock.shop/admin');
  });

  it('renders the 404 page for unknown paths', async () => {
    const res = await fetch(`${origin}/no-such-page`);
    assert.equal(res.status, 404);
    assert.match(await res.text(), /prerendered-404/);
  });
});
