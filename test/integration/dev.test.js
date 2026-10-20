import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { dev } from 'astro';
import { DEV_PORT_RANGE, freePort, pathOf } from '../helpers/fixture.js';
import { textById } from '../helpers/html.js';

// `astro dev` through the programmatic API: the server code runs inside MiniOxygen (workerd).
describe('minimal fixture under astro dev', () => {
  let server;
  let origin;
  before(async () => {
    const port = await freePort(DEV_PORT_RANGE);
    server = await dev({ root: pathOf('minimal'), server: { port, host: '127.0.0.1' }, logLevel: 'error' });
    origin = `http://127.0.0.1:${port}`;
  });
  after(() => server?.stop());

  const get = (path, init) => fetch(`${origin}${path}`, { redirect: 'manual', ...init });

  it('renders pages with a Storefront client', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.equal(textById(await res.text(), 'type'), 'public');
  });

  it('runs server code inside the Workers runtime', async () => {
    const info = await (await get('/api/info')).json();
    assert.equal(info.userAgent, 'Cloudflare-Workers');
    assert.equal(info.buyer.country, 'US');
  });

  it('serves Hydrogen routes', async () => {
    assert.deepEqual(await (await get('/api/cart')).json(), { cart: null });
  });

  it('renders prerendered pages on demand', async () => {
    const res = await get('/static');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /prerendered/);
  });

  it('redirects /admin to the store admin', async () => {
    const res = await get('/admin');
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), 'https://mock.shop/admin');
  });
});
