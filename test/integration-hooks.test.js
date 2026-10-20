import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import hydrogen from '../dist/index.js';

const dirs = [];
async function project(files = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'astro-hydrogen-hooks-')));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return dir;
}
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const SHARP = { entrypoint: 'astro/assets/services/sharp', config: {} };
const pluginNames = (update) => update.vite.plugins.flat(Infinity).map((plugin) => plugin.name);

async function setup(root, { command = 'build', options, config = {} } = {}) {
  const integration = hydrogen(options);
  const calls = { updateConfig: [], addMiddleware: [], addWatchFile: [], info: [] };
  await integration.hooks['astro:config:setup']({
    command,
    config: {
      root: pathToFileURL(root + '/'),
      base: '/',
      vite: {},
      image: { service: SHARP, endpoint: {} },
      build: {},
      // As with `adapter: hydrogen()`; the self-registration case sets `adapter: undefined`.
      adapter: integration,
      ...config,
    },
    updateConfig: (value) => calls.updateConfig.push(value),
    addMiddleware: (value) => calls.addMiddleware.push(value),
    addWatchFile: (value) => calls.addWatchFile.push(value),
    logger: { info: (message) => calls.info.push(message) },
  });
  return { integration, calls, update: calls.updateConfig[0] };
}

describe('astro:config:setup', () => {
  afterEach(() => {
    delete process.env.HYDROGEN_ASSET_BASE_URL;
    delete globalThis.__astroHydrogenPreview;
  });

  it('sets serverEntry, injects pre middleware, and registers the virtual/worker plugins', async () => {
    const root = await project();
    const { calls, update } = await setup(root);
    assert.equal(calls.updateConfig.length, 1);
    assert.equal(update.build.serverEntry, 'index.js');
    assert.deepEqual(calls.addMiddleware, [{ entrypoint: 'astro-hydrogen/entrypoints/middleware', order: 'pre' }]);
    assert.deepEqual(pluginNames(update), ['astro-hydrogen:virtual', 'astro-hydrogen:worker', 'astro-hydrogen:single-hydrogen-build']);
  });

  it('registers itself as the adapter when used as a plain integration (what `astro add` writes)', async () => {
    const root = await project();
    const { integration, calls } = await setup(root, { config: { adapter: undefined } });
    assert.equal(calls.updateConfig.length, 2);
    assert.deepEqual(calls.updateConfig[0], { adapter: integration });
    assert.match(calls.info[0], /Registered as the adapter/);
  });

  it('skips the middleware when `middleware: false`', async () => {
    const { calls } = await setup(await project(), { options: { middleware: false } });
    assert.equal(calls.addMiddleware.length, 0);
  });

  it('adds MiniOxygen plugins in dev only', async () => {
    const root = await project();
    const dev = pluginNames((await setup(root, { command: 'dev' })).update);
    assert.ok(dev.includes('oxygen:main'), dev.join());
    for (const command of ['build', 'preview']) {
      assert.ok(!pluginNames((await setup(root, { command })).update).some((name) => name.startsWith('oxygen:')));
    }
  });

  it('sets assetsPrefix from HYDROGEN_ASSET_BASE_URL on build only, and not over a user value', async () => {
    const root = await project();
    process.env.HYDROGEN_ASSET_BASE_URL = 'https://cdn.shopify.com/oxygen/123///';
    const build = await setup(root);
    assert.equal(build.update.build.assetsPrefix, 'https://cdn.shopify.com/oxygen/123');
    assert.match(build.calls.info[0], /Serving client assets from https:\/\/cdn\.shopify\.com\/oxygen\/123/);

    const user = await setup(root, { config: { build: { assetsPrefix: 'https://mine.example' } } });
    assert.equal('assetsPrefix' in user.update.build, false);

    for (const command of ['dev', 'preview']) {
      const other = await setup(root, { command });
      assert.equal('assetsPrefix' in other.update.build, false);
      assert.equal(other.calls.info.length, 0);
    }
    delete process.env.HYDROGEN_ASSET_BASE_URL;
    assert.equal('assetsPrefix' in (await setup(root)).update.build, false);
  });

  it('swaps the sharp image service for passthrough at runtime, keeping it for the build when split', async () => {
    const root = await project();
    const plain = await setup(root);
    assert.equal(plain.update.image.service.entrypoint, 'astro/assets/services/noop');

    const split = await setup(root, { config: { image: { service: { build: SHARP, runtime: SHARP }, endpoint: {} } } });
    assert.deepEqual(split.update.image.service.build, SHARP);
    assert.equal(split.update.image.service.runtime.entrypoint, 'astro/assets/services/noop');

    const runtimeCustom = await setup(root, {
      config: { image: { service: { build: SHARP, runtime: { entrypoint: './mine.ts', config: {} } }, endpoint: {} } },
    });
    assert.equal('service' in runtimeCustom.update.image, false);

    const custom = await setup(root, { config: { image: { service: { entrypoint: './mine.ts', config: {} }, endpoint: {} } } });
    assert.equal('service' in custom.update.image, false);
  });

  it('swaps the dev image endpoint only in dev and only when not user-set', async () => {
    const root = await project();
    const dev = await setup(root, { command: 'dev' });
    assert.equal(dev.update.image.endpoint.entrypoint, 'astro/assets/endpoint/generic');
    assert.equal('endpoint' in (await setup(root, { command: 'build' })).update.image, false);
    const userSet = await setup(root, {
      command: 'dev',
      config: { image: { service: SHARP, endpoint: { entrypoint: './my-endpoint.ts' } } },
    });
    assert.equal('endpoint' in userSet.update.image, false);
  });

  it('watches the config file, and fails clearly when an explicit one is missing', async () => {
    const root = await project({ 'src/hydrogen.config.ts': 'export default {}' });
    const { calls } = await setup(root);
    assert.deepEqual(calls.addWatchFile, [join(root, 'src/hydrogen.config.ts')]);
    assert.equal((await setup(await project())).calls.addWatchFile.length, 0);
    await assert.rejects(setup(root, { options: { configFile: 'missing.ts' } }), /configFile not found/);
  });

  it('hands preview options (with .env values and explicit env winning) over globalThis only for preview', async () => {
    const root = await project({ '.env': 'FROM_FILE=file\nBOTH=file' });
    await setup(root, { command: 'build' });
    await setup(root, { command: 'dev' });
    assert.equal(globalThis.__astroHydrogenPreview, undefined);
    await setup(root, {
      command: 'preview',
      options: { compatibilityDate: '2027-01-01', miniOxygen: { inspectorPort: 9229, debug: true, env: { BOTH: 'option' } } },
    });
    assert.deepEqual(globalThis.__astroHydrogenPreview, {
      compatibilityDate: '2027-01-01',
      miniOxygen: { inspectorPort: 9229, debug: true, env: { FROM_FILE: 'file', BOTH: 'option' } },
    });
  });

  it('loads .env into process.env on build only', async () => {
    const root = await project({ '.env': 'HT_HOOK_BUILD=1', '.env.development': 'HT_HOOK_DEV=1' });
    try {
      await setup(root, { command: 'dev' });
      assert.equal(process.env.HT_HOOK_DEV, undefined);
      await setup(root, { command: 'build' });
      assert.equal(process.env.HT_HOOK_BUILD, '1');
    } finally {
      delete process.env.HT_HOOK_BUILD;
    }
  });
});

describe('astro:routes:resolved', () => {
  const route = (pattern, isPrerendered) => ({ pattern, isPrerendered });
  const optionsModule = (update) =>
    update.vite.plugins.flat(Infinity).find((plugin) => plugin.name === 'astro-hydrogen:virtual').load('\0virtual:astro-hydrogen/options');

  it('records a prerendered 404 for the options module, which reads it when it loads', async () => {
    const root = await project();
    const { integration, update } = await setup(root);
    assert.ok(optionsModule(update).includes('export const prerendered404 = false;'));
    assert.ok(optionsModule(update).includes('export const middleware = true;'));

    integration.hooks['astro:routes:resolved']({ routes: [route('/', false), route('/404', true)] });
    assert.ok(optionsModule(update).includes('export const prerendered404 = true;'));

    integration.hooks['astro:routes:resolved']({ routes: [route('/404', false)] });
    assert.ok(optionsModule(update).includes('export const prerendered404 = false;'));
  });

  it('exports middleware: false when the adapter option turns it off', async () => {
    const root = await project();
    const { update } = await setup(root, { options: { middleware: false } });
    assert.ok(optionsModule(update).includes('export const middleware = false;'));
  });
});

describe('astro:config:done and astro:build:done', () => {
  it('registers the adapter and injects types', async () => {
    const integration = hydrogen();
    let adapter;
    let types;
    integration.hooks['astro:config:done']({
      config: {},
      setAdapter: (value) => (adapter = value),
      injectTypes: (value) => (types = value),
    });
    assert.deepEqual(types, { filename: 'types.d.ts', content: '/// <reference types="astro-hydrogen/types.d.ts" />' });
    assert.equal(adapter.name, 'astro-hydrogen');
    assert.equal(adapter.entrypointResolution, 'auto');
    assert.equal(adapter.serverEntrypoint, 'astro-hydrogen/entrypoints/server');
    assert.equal(adapter.previewEntrypoint, 'astro-hydrogen/entrypoints/preview');
    assert.deepEqual(adapter.adapterFeatures, {
      buildOutput: 'server',
      middlewareMode: 'classic',
      preserveBuildClientDir: true,
      preserveBuildServerDir: true,
    });
    assert.deepEqual(
      { ...adapter.supportedAstroFeatures, sharpImageService: undefined },
      {
        serverOutput: 'stable',
        hybridOutput: 'stable',
        staticOutput: 'stable',
        envGetSecret: 'stable',
        i18nDomains: 'experimental',
        sharpImageService: undefined,
      },
    );
    assert.equal(adapter.supportedAstroFeatures.sharpImageService.support, 'limited');
  });

  it('bundles the worker, writes oxygen.json and logs deploy instructions', async () => {
    const root = await project({
      'dist/server/index.js': `import { n } from './chunks/n.js';\nexport default { n };\n`,
      'dist/server/chunks/n.js': 'export const n = () => globalThis.marker;\n',
      'dist/client/a.txt': 'x',
    });
    for (const compatibilityDate of [undefined, '2027-02-02']) {
      const integration = hydrogen(compatibilityDate ? { compatibilityDate } : {});
      const rootUrl = pathToFileURL(root + '/');
      integration.hooks['astro:config:done']({
        config: {
          root: rootUrl,
          build: { server: new URL('dist/server/', rootUrl), client: new URL('dist/client/', rootUrl) },
        },
        setAdapter() {},
        injectTypes() {},
      });
      const messages = [];
      await integration.hooks['astro:build:done']({ logger: { info: (message) => messages.push(message) } });
      assert.deepEqual(JSON.parse(await readFile(join(root, 'dist/server/oxygen.json'), 'utf8')), {
        version: 1,
        compatibility_date: compatibilityDate ?? '2026-04-01',
      });
      assert.deepEqual((await readdir(join(root, 'dist/server'))).sort(), ['index.js', 'oxygen.json']);
      assert.equal(messages.length, 1);
      assert.ok(messages[0].includes('Oxygen Worker: dist/server, assets: dist/client.'), messages[0]);
      assert.ok(messages[0].includes('shopify hydrogen deploy --worker-dir dist/server --assets-dir dist/client'));
    }
  });
});
