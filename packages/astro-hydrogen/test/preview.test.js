/** Runs the real preview entry with Vite's `preview` and MiniOxygen's `oxygen` stubbed. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { register } from 'node:module';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const stubs = {
  vite: 'export const preview = (...args) => globalThis.__vitePreview(...args);',
  '@shopify/mini-oxygen/vite': 'export const oxygen = (...args) => globalThis.__oxygen(...args);',
};
const hook = `
const stubs = ${JSON.stringify(stubs)};
export async function resolve(specifier, context, next) {
  if (specifier in stubs) return { url: 'astro-hydrogen-test:' + specifier, shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.startsWith('astro-hydrogen-test:')) {
    return { format: 'module', shortCircuit: true, source: stubs[url.slice('astro-hydrogen-test:'.length)] };
  }
  return next(url, context);
}`;

let createPreviewServer;
const state = {};

before(async () => {
  globalThis.__oxygen = (options) => {
    state.oxygenOptions = options;
    state.registered = [];
    return [
      { name: 'other' },
      { name: 'oxygen:main', api: { registerPluginOptions: (value) => state.registered.push(value) } },
    ];
  };
  globalThis.__vitePreview = async (config) => {
    state.viteConfig = config;
    state.httpServer = new EventEmitter();
    return {
      httpServer: state.httpServer,
      resolvedUrls: state.resolvedUrls,
      close: async () => (state.closed = true),
    };
  };
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
  createPreviewServer = (await import('../dist/entrypoints/preview.js')).default;
});

beforeEach(() => {
  for (const key of Object.keys(state)) delete state[key];
  delete globalThis.__astroHydrogenPreview;
  state.resolvedUrls = { local: ['http://localhost:4321/'] };
});

const root = pathToFileURL('/project/');
const params = (overrides = {}) => {
  const messages = [];
  return {
    messages,
    args: {
      root,
      client: new URL('dist/client/', root),
      server: new URL('dist/server/', root),
      base: '/shop',
      host: '127.0.0.1',
      port: 4321,
      headers: { 'x-test': '1' },
      allowedHosts: ['example.com'],
      open: undefined,
      logger: { info: (message) => messages.push(message) },
      ...overrides,
    },
  };
};

describe('preview entrypoint', () => {
  it('passes the built Worker and the handoff options to MiniOxygen', async () => {
    globalThis.__astroHydrogenPreview = {
      compatibilityDate: '2027-03-03',
      miniOxygen: { env: { A: '1' }, inspectorPort: 9229, debug: true },
    };
    await createPreviewServer(params().args);
    assert.deepEqual(state.oxygenOptions, {
      previewEntry: fileURLToPath(new URL('dist/server/index.js', root)),
      env: { A: '1' },
      inspectorPort: 9229,
      debug: true,
    });
    assert.deepEqual(state.registered, [{ compatibilityDate: '2027-03-03' }]);
  });

  it('works without the handoff and does not register plugin options', async () => {
    await createPreviewServer(params().args);
    assert.deepEqual(state.oxygenOptions, {
      previewEntry: '/project/dist/server/index.js',
      env: undefined,
      inspectorPort: undefined,
      debug: undefined,
    });
    assert.deepEqual(state.registered, []);
  });

  it('configures Vite preview for a custom app serving the client directory', async () => {
    const { args } = params();
    await createPreviewServer(args);
    const config = state.viteConfig;
    assert.equal(config.configFile, false);
    assert.equal(config.root, '/project/');
    assert.equal(config.base, '/shop');
    assert.equal(config.appType, 'custom');
    assert.deepEqual(config.build, { outDir: '/project/dist/client/' });
    assert.deepEqual(config.preview, { host: '127.0.0.1', port: 4321, headers: { 'x-test': '1' }, open: false, allowedHosts: ['example.com'] });
    assert.deepEqual(config.plugins.map((plugin) => plugin.name), ['other', 'oxygen:main']);

    await createPreviewServer({ ...args, open: '/start' });
    assert.equal(state.viteConfig.preview.open, '/start');
  });

  it('logs the address and returns host, port, server, closed and stop', async () => {
    const { args, messages } = params();
    const result = await createPreviewServer(args);
    assert.deepEqual(messages, ['Oxygen preview running at http://localhost:4321/']);
    assert.equal(result.host, '127.0.0.1');
    assert.equal(result.port, 4321);
    assert.equal(result.server, state.httpServer);

    let settled = false;
    const closed = result.closed().then(() => (settled = true));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    state.httpServer.emit('close');
    await closed;

    await result.stop();
    assert.equal(state.closed, true);
  });

  it('rejects closed() when the server errors, and stays quiet without a resolved URL', async () => {
    state.resolvedUrls = undefined;
    const { args, messages } = params();
    const result = await createPreviewServer(args);
    assert.deepEqual(messages, []);
    const closed = result.closed();
    state.httpServer.emit('error', new Error('EADDRINUSE'));
    await assert.rejects(closed, /EADDRINUSE/);
  });
});
