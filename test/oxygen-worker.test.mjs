/**
 * Builds the playground as `shopify hydrogen deploy` would, then runs the Worker in MiniOxygen
 * (workerd) with the client assets on a simulated Oxygen CDN. Needs network access to mock.shop.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildAssetsUrl, createMiniOxygen, Request } from '@shopify/mini-oxygen';

const playground = fileURLToPath(new URL('../playground/', import.meta.url));
const workerDir = new URL('../playground/dist/server/', import.meta.url);
const ASSETS_PORT = 9177;
const ORIGIN = 'http://localhost';

let miniOxygen;

before(async () => {
  execFileSync('npx', ['astro', 'build'], {
    cwd: playground,
    stdio: 'pipe',
    env: { ...process.env, HYDROGEN_ASSET_BASE_URL: buildAssetsUrl(ASSETS_PORT) },
  });

  const workerFile = fileURLToPath(new URL('index.js', workerDir));
  miniOxygen = createMiniOxygen({
    assets: { directory: fileURLToPath(new URL('../client/', workerDir)), port: ASSETS_PORT },
    requestHook: null,
    workers: [
      {
        name: 'storefront',
        modulesRoot: fileURLToPath(workerDir),
        modules: [{ type: 'ESModule', path: workerFile, contents: readFileSync(workerFile, 'utf8') }],
        compatibilityDate: JSON.parse(readFileSync(new URL('oxygen.json', workerDir), 'utf8')).compatibility_date,
        bindings: {},
      },
    ],
  });
  await miniOxygen.ready;
});

after(() => miniOxygen?.dispose());

// Miniflare drops the method and body of a plain init object; pass its own Request instead.
const get = (path, init) =>
  miniOxygen.dispatchFetch(new Request(`${ORIGIN}${path}`, { redirect: 'manual', ...init }));

describe('build output', () => {
  it('is one Worker module plus oxygen.json', () => {
    assert.deepEqual(readdirSync(workerDir).sort(), ['index.js', 'oxygen.json']);
  });
});

describe('Oxygen Worker', () => {
  it('server-renders pages with Storefront API data', async () => {
    const response = await get('/');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<h1>Mock\.shop<\/h1>/);
    assert.match(html, /href="\/products\/[^"]+"/);
    assert.match(html, /<footer/, 'renders the footer (built-in content without Contentstack)');
    assert.ok(html.includes(buildAssetsUrl(ASSETS_PORT)), 'client assets use the CDN prefix');
  });

  it('serves prerendered pages from the asset CDN', async () => {
    const response = await get('/about');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /data-built-at/);
  });

  it('serves public files from assets', async () => {
    const response = await get('/robots.txt');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /User-agent/);
  });

  it('runs inside the Workers runtime with Oxygen locals', async () => {
    const info = await (await get('/api/runtime.json')).json();
    assert.equal(info.runtime, 'Cloudflare-Workers');
    assert.equal(info.oxygen, true);
    assert.equal(info.workerCache, true);
  });

  it('serves Hydrogen routes before Astro routing', async () => {
    assert.deepEqual(await (await get('/api/cart')).json(), { cart: null });

    const proxy = await get('/api/2026-04/graphql.json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ shop { name } }' }),
    });
    assert.equal((await proxy.json()).data.shop.name, 'Mock.shop');
  });

  it('runs Shopify redirects after a 404, and keeps real 404s', async () => {
    const admin = await get('/admin');
    assert.equal(admin.status, 301);
    assert.equal(admin.headers.get('location'), 'https://mock.shop/admin');
    assert.equal((await get('/definitely-not-a-page')).status, 404);
  });

  it('adds to cart with a plain HTML form and renders the cart server-side', async () => {
    const productHtml = await (await get('/products/slides')).text();
    const merchandiseId = productHtml.match(/name="merchandiseId" value="([^"]+)"/)?.[1];
    assert.ok(merchandiseId, 'product page renders the selected variant');

    const add = await get('/api/cart', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: ORIGIN,
        referer: `${ORIGIN}/products/slides`,
      },
      body: new URLSearchParams({ merchandiseId, quantity: '1', intent: 'add' }).toString(),
    });
    assert.equal(add.status, 303);
    const cookie = add.headers.get('set-cookie')?.split(';')[0];
    assert.match(cookie ?? '', /^cart=/);

    const cart = await (await get('/cart', { headers: { cookie } })).text();
    assert.match(cart, /Subtotal:/);
    assert.match(cart, /checkout/);
  });
});
