/** `routeTemplates` is read when the middleware module loads, so it gets its own process. */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { before, describe, it } from 'node:test';

const hook = `
export async function resolve(specifier, context, next) {
  if (specifier === 'virtual:astro-hydrogen/config') return { url: 'astro-hydrogen-test:config', shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url === 'astro-hydrogen-test:config') {
    return { format: 'module', shortCircuit: true, source: 'export default globalThis.__hydrogenTestConfig;' };
  }
  return next(url, context);
}`;

let onRequest;
before(async () => {
  globalThis.fetch = async () => Response.json({ data: { urlRedirects: { edges: [] } } });
  globalThis.__hydrogenTestConfig = { routeTemplates: { collectionList: '/catalog' } };
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
  ({ onRequest } = await import('../dist/entrypoints/middleware.js'));
});

describe('middleware with custom routeTemplates', () => {
  it('redirects Shopify\'s standard paths to the app\'s templates on a 404', async () => {
    const url = new URL('https://shop.example/collections');
    const locals = { oxygen: { env: { PUBLIC_STORE_DOMAIN: 'shop.myshopify.com' }, waitUntil() {}, cache: undefined } };
    const response = await onRequest(
      { request: new Request(url, { redirect: 'manual' }), url, locals, isPrerendered: false },
      async () => new Response('missing', { status: 404 }),
    );
    assert.equal(response.status, 301);
    assert.equal(new URL(response.headers.get('location'), url).pathname, '/catalog');
  });
});
