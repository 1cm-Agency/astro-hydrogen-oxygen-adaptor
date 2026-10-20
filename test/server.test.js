/**
 * Runs the real Worker entry in Node. A loader hook swaps the Astro/virtual modules it imports
 * for stubs backed by globals, so each test can drive the fake app.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { before, beforeEach, afterEach, describe, it } from 'node:test';

const stubs = {
  'astro/app/entrypoint': 'export const createApp = () => globalThis.__fakeApp;',
  'astro/env/setup': 'export const setGetEnv = (fn) => globalThis.__setGetEnv(fn);',
  'virtual:astro-hydrogen/options':
    'export let cacheName, base, assetBaseUrl, middleware, prerendered404;' +
    'globalThis.__applyOptions = (o) => ({ cacheName, base, assetBaseUrl, middleware, prerendered404 } = o);',
};
// The Hydrogen request setup has its own tests (hydrogen-request.test.js); here it is a recorder.
const handlerStub = 'export const handleUnmatchedRequest = (args) => globalThis.__handleUnmatched(args);';
const hook = `
const stubs = ${JSON.stringify(stubs)};
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('runtime/hydrogen-request.js')) return { url: 'astro-hydrogen-test:handler', shortCircuit: true };
  if (specifier in stubs) return { url: 'astro-hydrogen-test:' + specifier, shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url === 'astro-hydrogen-test:handler') return { format: 'module', shortCircuit: true, source: ${JSON.stringify(handlerStub)} };
  if (url.startsWith('astro-hydrogen-test:')) {
    return { format: 'module', shortCircuit: true, source: stubs[url.slice('astro-hydrogen-test:'.length)] };
  }
  return next(url, context);
}`;

const state = {};
let worker;
const realFetch = globalThis.fetch;
const realConsoleError = console.error;

before(async () => {
  globalThis.__handleUnmatched = async (args) => {
    state.unmatched = args;
    return state.unmatchedResponse;
  };
  globalThis.__setGetEnv = (fn) => (state.getEnv = fn);
  globalThis.__fakeApp = {
    isDev: () => state.isDev,
    devMatch: async (pathname) => {
      state.devMatchPathname = pathname;
      return state.devMatchResult;
    },
    match: (request, allowPrerender) => (allowPrerender ? state.prerenderMatch : state.match),
    removeBase: (pathname) => pathname.replace(/^\/shop/, '') || '/',
    getPathnameFromRequest: (request) => new URL(request.url).pathname,
    render: async (request, options) => {
      state.render = { request, options };
      if (state.renderError) throw state.renderError;
      return new Response('rendered');
    },
  };
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
  worker = (await import('../dist/entrypoints/server.js')).default;
  setOptions({});
});

// The options stub exposes live bindings, so one loaded Worker can run with any flag combination.
function setOptions(options) {
  globalThis.__applyOptions({
    cacheName: 'test-cache',
    base: '/shop',
    assetBaseUrl: undefined,
    middleware: true,
    prerendered404: false,
    ...options,
  });
}

beforeEach(() => {
  for (const key of Object.keys(state)) delete state[key];
  setOptions({});
  state.isDev = false;
  state.match = { route: 'page', prerender: false };
  delete globalThis.caches;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realConsoleError;
  delete globalThis.caches;
});

function ctx() {
  const calls = [];
  return {
    calls,
    waitUntil(promise) {
      calls.push({ self: this, promise });
    },
  };
}
const call = (url, { env = {}, init, context = ctx() } = {}) =>
  worker.fetch(new Request(url, init), env, context).then((response) => ({ response, context }));

describe('Worker entry: request wiring', () => {
  it('passes locals.oxygen with env, a bound waitUntil, and the opened cache', async () => {
    const opened = [];
    const cache = { name: 'the-cache' };
    globalThis.caches = { open: async (name) => (opened.push(name), cache) };
    const env = { A: 'a' };
    const context = ctx();
    const { response } = await call('https://shop.example/p', { env, context });
    assert.equal(await response.text(), 'rendered');
    assert.deepEqual(opened, ['test-cache']);
    const { locals, waitUntil, addCookieHeader, routeData } = state.render.options;
    assert.equal(locals.oxygen.env, env);
    assert.equal(locals.oxygen.cache, cache);
    assert.equal(addCookieHeader, true);
    assert.equal(routeData, state.match);
    const promise = Promise.resolve();
    locals.oxygen.waitUntil(promise);
    waitUntil(promise);
    assert.equal(context.calls.length, 2);
    assert.ok(context.calls.every((entry) => entry.self === context && entry.promise === promise));
  });

  it('leaves cache undefined when caches is missing or throws', async () => {
    await call('https://shop.example/p');
    assert.equal(state.render.options.locals.oxygen.cache, undefined);
    globalThis.caches = { open: async () => Promise.reject(new Error('nope')) };
    await call('https://shop.example/p');
    assert.equal(state.render.options.locals.oxygen.cache, undefined);
    globalThis.caches = { open: () => { throw new Error('sync'); } };
    await call('https://shop.example/p');
    assert.equal(state.render.options.locals.oxygen.cache, undefined);
  });

  it('coerces env values for astro:env', async () => {
    await call('https://shop.example/p', { env: { S: 'str', N: 5, B: false, O: { a: 1 }, U: undefined } });
    assert.equal(state.getEnv('S'), 'str');
    assert.equal(state.getEnv('N'), '5');
    assert.equal(state.getEnv('B'), 'false');
    assert.equal(state.getEnv('O'), undefined);
    assert.equal(state.getEnv('U'), undefined);
    assert.equal(state.getEnv('MISSING'), undefined);
  });

  it('derives clientAddress from the first oxygen-buyer-ip segment, undefined if invalid', async () => {
    await call('https://shop.example/p', { init: { headers: { 'oxygen-buyer-ip': '203.0.113.7, 10.0.0.1' } } });
    assert.equal(state.render.options.clientAddress, '203.0.113.7');
    await call('https://shop.example/p', { init: { headers: { 'oxygen-buyer-ip': 'not an ip' } } });
    assert.equal(state.render.options.clientAddress, undefined);
    await call('https://shop.example/p');
    assert.equal(state.render.options.clientAddress, undefined);
  });

  it('upgrades http to https only behind x-forwarded-proto: https', async () => {
    await call('http://shop.example/p?q=1', { init: { headers: { 'x-forwarded-proto': 'https' } } });
    assert.equal(state.render.request.url, 'https://shop.example/p?q=1');
    await call('http://shop.example/p');
    assert.equal(state.render.request.url, 'http://shop.example/p');
    await call('http://shop.example/p', { init: { headers: { 'x-forwarded-proto': 'http' } } });
    assert.equal(state.render.request.url, 'http://shop.example/p');
    await call('https://shop.example/p', { init: { headers: { 'x-forwarded-proto': 'https' } } });
    assert.equal(state.render.request.url, 'https://shop.example/p');
  });
});

describe('Worker entry: prerendered pages', () => {
  it('fetches an unmatched prerendered page from the client assets', async () => {
    state.match = undefined;
    state.prerenderMatch = { prerender: true };
    const fetched = [];
    globalThis.fetch = async (url, init) => {
      fetched.push({ url: String(url), headers: init.headers });
      return new Response('<h1>static</h1>', { headers: { 'content-type': 'text/plain' } });
    };
    const { response } = await call('https://shop.example/shop/about');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<h1>static</h1>');
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(fetched[0].url, 'https://shop.example/shop/about/index.html');
    assert.equal(fetched[0].headers['x-astro-hydrogen-asset'], '1');
    assert.equal(state.render, undefined);
  });

  it('skips the lookup for the Worker\'s own asset subrequests', async () => {
    state.match = undefined;
    state.prerenderMatch = { prerender: true };
    globalThis.fetch = async () => assert.fail('must not fetch');
    await call('https://shop.example/about', { init: { headers: { 'x-astro-hydrogen-asset': '1' } } });
    assert.equal(state.render.options.routeData, undefined);
  });

  it('falls through to render when the miss is not prerendered or the asset is absent', async () => {
    state.match = undefined;
    state.prerenderMatch = { prerender: false };
    globalThis.fetch = async () => assert.fail('must not fetch');
    await call('https://shop.example/nowhere');
    assert.ok(state.render);

    delete state.render;
    state.prerenderMatch = { prerender: true };
    globalThis.fetch = async () => new Response('missing', { status: 404 });
    await call('https://shop.example/nowhere');
    assert.ok(state.render);

    delete state.render;
    state.prerenderMatch = undefined;
    await call('https://shop.example/nowhere');
    assert.ok(state.render);
  });

  it('uses devMatch and never fetches in dev', async () => {
    state.isDev = true;
    state.devMatchResult = { routeData: { route: 'dev-page' } };
    globalThis.fetch = async () => assert.fail('must not fetch');
    await call('https://shop.example/shop/x');
    assert.equal(state.devMatchPathname, '/shop/x');
    assert.deepEqual(state.render.options.routeData, { route: 'dev-page' });

    state.devMatchResult = undefined;
    await call('https://shop.example/y');
    assert.equal(state.render.options.routeData, undefined);
  });

  it('prerenderedErrorPageFetch strips base, and falls back to a 404 response', async () => {
    await call('https://shop.example/shop/boom');
    const { prerenderedErrorPageFetch } = state.render.options;
    const fetched = [];
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return new Response('<h1>404</h1>');
    };
    const page = await prerenderedErrorPageFetch('/shop/404.html');
    assert.equal(await page.text(), '<h1>404</h1>');
    assert.equal(fetched[0], 'https://shop.example/shop/404.html');

    globalThis.fetch = async () => new Response('nope', { status: 404 });
    const fallback = await prerenderedErrorPageFetch('https://shop.example/shop/404.html');
    assert.equal(fallback.status, 404);
    assert.equal(await fallback.text(), 'Not found');
  });
});

describe('Worker entry: prerendered 404 page', () => {
  const withOptions = (options) => ({
    fetch: (...args) => (setOptions(options), worker.fetch(...args)),
  });
  const enabled = withOptions({ prerendered404: true });
  const noMiddleware = withOptions({ prerendered404: true, middleware: false });
  const no404 = withOptions({ prerendered404: false });
  const miss = () => {
    state.match = undefined;
    state.prerenderMatch = undefined;
  };
  const via = (entry, url = 'https://shop.example/api/cart', init) =>
    entry.fetch(new Request(url, init), { A: 'a' }, ctx());

  it('answers an unmatched URL with the Hydrogen response, without rendering', async () => {
    miss();
    state.unmatchedResponse = new Response('cart!');
    const response = await via(enabled);
    assert.equal(await response.text(), 'cart!');
    assert.equal(state.render, undefined);
    assert.equal(state.unmatched.request.url, 'https://shop.example/api/cart');
    assert.equal(state.unmatched.url.pathname, '/api/cart');
    assert.deepEqual(state.unmatched.runtime.env, { A: 'a' });
  });

  it('falls through to render (the static 404) when Hydrogen has no answer', async () => {
    miss();
    state.unmatchedResponse = undefined;
    assert.equal(await (await via(enabled)).text(), 'rendered');
    assert.ok(state.unmatched);
    assert.equal(state.render.options.routeData, undefined);
  });

  it('leaves matched routes and prerendered pages alone', async () => {
    await via(enabled); // on-demand route: the middleware handles it
    assert.equal(state.unmatched, undefined);
    state.match = undefined;
    state.prerenderMatch = { prerender: true };
    globalThis.fetch = async () => new Response('missing', { status: 404 });
    await via(enabled);
    assert.equal(state.unmatched, undefined);
  });

  it('skips the Worker\'s own asset subrequests', async () => {
    miss();
    await via(enabled, 'https://shop.example/api/cart', { headers: { 'x-astro-hydrogen-asset': '1' } });
    assert.equal(state.unmatched, undefined);
  });

  it('does nothing when the 404 page is on demand or the middleware is off', async () => {
    miss();
    state.unmatchedResponse = new Response('cart!');
    for (const entry of [no404, noMiddleware]) {
      assert.equal(await (await via(entry)).text(), 'rendered');
      assert.equal(state.unmatched, undefined);
    }
  });

  it('in dev, treats the 404 route as a miss unless /404 itself was requested', async () => {
    state.isDev = true;
    state.unmatchedResponse = new Response('cart!');
    state.devMatchResult = { routeData: { route: '/404' } };
    assert.equal(await (await via(enabled)).text(), 'cart!');

    delete state.render;
    delete state.unmatched;
    state.devMatchResult = { routeData: { route: '/404' } };
    assert.equal(await (await via(enabled, 'https://shop.example/shop/404/')).text(), 'rendered');
    assert.equal(state.unmatched, undefined);

    state.devMatchResult = { routeData: { route: '/products' } };
    await via(enabled);
    assert.equal(state.unmatched, undefined);

    state.devMatchResult = undefined;
    state.unmatchedResponse = new Response('cart!');
    assert.equal(await (await via(enabled)).text(), 'cart!');
  });
});

describe('Worker entry: failures', () => {
  it('returns a generic 500 and logs when render throws', async () => {
    const logged = [];
    console.error = (...args) => logged.push(args);
    state.renderError = new Error('kaboom');
    const { response } = await call('https://shop.example/p');
    assert.equal(response.status, 500);
    assert.equal(await response.text(), 'An unexpected error occurred');
    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], state.renderError);
  });
});
