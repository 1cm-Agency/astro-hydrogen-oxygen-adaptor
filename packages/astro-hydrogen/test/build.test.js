import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  PROCESS_SHIM,
  bundleWorker,
  installedDeps,
  isPrerendered404,
  loadDotEnvIntoProcess,
  miniOxygenDevPlugins,
  nodeBuiltinsPlugin,
  oxygenWorkerPlugin,
  readDotEnv,
  removeEmptyDirs,
  resolveConfigFile,
  singleHydrogenBuildPlugin,
  virtualModulesPlugin,
} from '../dist/build.js';

const dirs = [];
async function tmp() {
  // realpath: Rolldown reports resolved module ids, and macOS's tmpdir is a symlink.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'astro-hydrogen-build-')));
  dirs.push(dir);
  return dir;
}
async function put(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), content);
  }
}
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

describe('readDotEnv / loadDotEnvIntoProcess', () => {
  it('applies .env < .env.local < .env.<mode> < .env.<mode>.local', async () => {
    const root = await tmp();
    await put(root, {
      '.env': 'A=env\nB=env\nC=env\nD=env\nONLY_BASE=1',
      '.env.local': 'B=local\nC=local\nD=local',
      '.env.production': 'C=mode\nD=mode',
      '.env.production.local': 'D=modelocal',
      '.env.development': 'A=wrong-mode',
    });
    assert.deepEqual(readDotEnv(root, 'production'), { A: 'env', B: 'local', C: 'mode', D: 'modelocal', ONLY_BASE: '1' });
  });

  it('returns {} when no files exist', async () => {
    assert.deepEqual(readDotEnv(await tmp(), 'production'), {});
  });

  it('loadDotEnvIntoProcess does not override existing process.env', async () => {
    const root = await tmp();
    await put(root, { '.env': 'HT_EXISTING=file\nHT_NEW=file' });
    process.env.HT_EXISTING = 'shell';
    delete process.env.HT_NEW;
    try {
      loadDotEnvIntoProcess(root, 'production');
      assert.equal(process.env.HT_EXISTING, 'shell');
      assert.equal(process.env.HT_NEW, 'file');
    } finally {
      delete process.env.HT_EXISTING;
      delete process.env.HT_NEW;
    }
  });
});

describe('resolveConfigFile', () => {
  it('accepts explicit absolute and relative paths', async () => {
    const root = await tmp();
    await put(root, { 'custom/h.js': '', 'src/hydrogen.config.ts': '' });
    assert.equal(resolveConfigFile(root, 'custom/h.js'), join(root, 'custom/h.js'));
    assert.equal(resolveConfigFile(root, join(root, 'custom/h.js')), join(root, 'custom/h.js'));
  });

  it('throws naming the path when an explicit file is missing', async () => {
    const root = await tmp();
    assert.throws(() => resolveConfigFile(root, 'nope.ts'), (error) => {
      assert.ok(error.message.includes(join(root, 'nope.ts')));
      return true;
    });
  });

  it('auto-detects in the order ts > mts > js > mjs, or returns undefined', async () => {
    const root = await tmp();
    assert.equal(resolveConfigFile(root, undefined), undefined);
    const names = ['mjs', 'js', 'mts', 'ts'];
    for (const ext of names) {
      await put(root, { [`src/hydrogen.config.${ext}`]: '' });
      assert.equal(resolveConfigFile(root, undefined), join(root, `src/hydrogen.config.${ext}`));
    }
  });
});

describe('installedDeps', () => {
  it('keeps only resolvable specifiers, including the `a > b` syntax and subpaths', async () => {
    const root = await tmp();
    await put(root, {
      'node_modules/react/package.json': '{"name":"react","version":"1.0.0"}',
      'node_modules/react/jsx-runtime.js': '',
      'node_modules/astro/package.json': '{"name":"astro","version":"1.0.0"}',
      'node_modules/astro/node_modules/picomatch/package.json': '{"name":"picomatch","version":"1.0.0"}',
      'node_modules/other/package.json': '{"name":"other","version":"1.0.0"}',
    });
    const result = installedDeps(root, [
      'astro > picomatch',
      'astro > missing',
      'other > picomatch',
      'react',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom',
    ]);
    assert.deepEqual(result, ['astro > picomatch', 'react', 'react/jsx-runtime']);
  });
});

describe('virtualModulesPlugin', () => {
  const make = (values = {}) =>
    virtualModulesPlugin({
      configFile: undefined,
      cacheName: 'hydrogen',
      assetBaseUrl: undefined,
      base: '/',
      middleware: true,
      routes: { prerendered404: false },
      ...values,
    });
  const load = (plugin, id) => plugin.load(`\0${id}`);

  it('resolves only its two virtual ids', () => {
    const plugin = make();
    assert.equal(plugin.name, 'astro-hydrogen:virtual');
    assert.equal(plugin.resolveId('virtual:astro-hydrogen/config'), '\0virtual:astro-hydrogen/config');
    assert.equal(plugin.resolveId('virtual:astro-hydrogen/options'), '\0virtual:astro-hydrogen/options');
    assert.equal(plugin.resolveId('virtual:other'), undefined);
    assert.equal(plugin.load('something-else'), undefined);
  });

  it('config module re-exports the config file, or an empty object', () => {
    assert.equal(load(make(), 'virtual:astro-hydrogen/config'), 'export default {};');
    assert.equal(
      load(make({ configFile: '/p/src/hydrogen.config.ts' }), 'virtual:astro-hydrogen/config'),
      'export { default } from "/p/src/hydrogen.config.ts";',
    );
  });

  it('options module serializes cacheName, normalized base and assetBaseUrl', () => {
    assert.equal(
      load(make(), 'virtual:astro-hydrogen/options'),
      'export const cacheName = "hydrogen";\nexport const base = "";\nexport const assetBaseUrl = undefined;\n' +
        'export const middleware = true;\nexport const prerendered404 = false;',
    );
    const shop = load(make({ cacheName: 'c', base: '/shop/', assetBaseUrl: 'https://cdn.example/x' }), 'virtual:astro-hydrogen/options');
    assert.ok(shop.includes('export const cacheName = "c";'));
    assert.ok(shop.includes('export const base = "/shop";'));
    assert.ok(shop.includes('export const assetBaseUrl = "https://cdn.example/x";'));
    assert.ok(load(make({ base: '/shop' }), 'virtual:astro-hydrogen/options').includes('export const base = "/shop";'));
  });
});

describe('virtualModulesPlugin: route state', () => {
  const options = (plugin) => plugin.load('\0virtual:astro-hydrogen/options');

  it('reads prerendered404 lazily, so a hook that runs after setup is still seen', () => {
    const routes = { prerendered404: false };
    const plugin = virtualModulesPlugin({
      configFile: undefined,
      cacheName: 'h',
      assetBaseUrl: undefined,
      base: '/',
      middleware: false,
      routes,
    });
    assert.ok(options(plugin).includes('export const prerendered404 = false;'));
    assert.ok(options(plugin).includes('export const middleware = false;'));
    routes.prerendered404 = true;
    assert.ok(options(plugin).includes('export const prerendered404 = true;'));
  });
});

describe('isPrerendered404', () => {
  it('is true only for a prerendered /404 route', () => {
    const route = (pattern, isPrerendered) => ({ pattern, isPrerendered });
    assert.equal(isPrerendered404([]), false);
    assert.equal(isPrerendered404([route('/', true), route('/404', false)]), false);
    assert.equal(isPrerendered404([route('/', false), route('/404', true)]), true);
    assert.equal(isPrerendered404([route('/blog/404', true)]), false);
  });
});

describe('oxygenWorkerPlugin', () => {
  it('configures only the ssr environment', async () => {
    const root = await tmp();
    await put(root, { 'node_modules/react/package.json': '{"name":"react","version":"1.0.0"}' });
    const plugin = oxygenWorkerPlugin(root);
    assert.equal(plugin.configEnvironment('client', {}, { mode: 'production', command: 'build' }), undefined);

    const build = plugin.configEnvironment('ssr', {}, { mode: 'production', command: 'build' });
    assert.equal(build.resolve.noExternal, true);
    assert.ok(build.resolve.conditions.includes('workerd'));
    assert.equal(build.define['process.env.NODE_ENV'], '"production"');
    assert.equal('optimizeDeps' in build, false);

    const serve = plugin.configEnvironment('ssr', {}, { mode: 'development', command: 'serve' });
    assert.equal(serve.define['process.env.NODE_ENV'], '"development"');
    assert.deepEqual(serve.optimizeDeps.include, ['react']);
  });
});

describe('singleHydrogenBuildPlugin', () => {
  const root = resolve(import.meta.dirname, '..');
  const plugin = singleHydrogenBuildPlugin(root);

  it('is serve-only, pre, ssr-only', () => {
    assert.equal(plugin.apply, 'serve');
    assert.equal(plugin.enforce, 'pre');
    assert.equal(plugin.applyToEnvironment({ name: 'ssr' }), true);
    assert.equal(plugin.applyToEnvironment({ name: 'client' }), false);
  });

  it('resolves @shopify/hydrogen the way Node does, and ignores other ids', () => {
    const expected = createRequire(join(root, 'package.json')).resolve('@shopify/hydrogen');
    const resolved = plugin.resolveId('@shopify/hydrogen');
    assert.equal(resolved, expected);
    assert.ok(!/development/.test(resolved), resolved);
    assert.equal(plugin.resolveId('@shopify/hydrogen/customer-account'), undefined);
    assert.equal(plugin.resolveId('react'), undefined);
  });

  it('returns undefined when Hydrogen is not installed', async () => {
    const missing = singleHydrogenBuildPlugin(await tmp());
    assert.equal(missing.resolveId('@shopify/hydrogen'), undefined);
  });
});

describe('nodeBuiltinsPlugin', () => {
  it('externalizes node: ids and records only static imports', () => {
    const seen = new Set();
    const plugin = nodeBuiltinsPlugin(seen);
    assert.equal(plugin.resolveId('./local.js', '/a.js', { kind: 'import-statement' }), undefined);
    assert.deepEqual(plugin.resolveId('node:stream', '/a.js', { kind: 'dynamic-import' }), { id: 'node:stream', external: true });
    assert.equal(seen.size, 0);
    plugin.resolveId('node:fs', '/a.js', { kind: 'import-statement' });
    plugin.resolveId('node:os', undefined, { kind: 'require-call' });
    assert.deepEqual([...seen], ['node:fs (from /a.js)', 'node:os']);
  });

  it('rewrites dynamic node: imports, including with comments, into rejections', () => {
    const plugin = nodeBuiltinsPlugin(new Set());
    assert.equal(plugin.renderChunk('const a = 1;'), undefined);
    assert.equal(plugin.renderChunk('// node: mention only'), '// node: mention only');
    const code = [
      `await import('node:stream');`,
      `await import(/* @vite-ignore */ "node:fs");`,
      `await import( /* a */ /* b */ 'node:os' );`,
      `await import('./local.js');`,
      `await import(variable);`,
    ].join('\n');
    const out = plugin.renderChunk(code);
    assert.ok(out.includes('Promise.reject(new Error("node:stream is not available on Oxygen."))'));
    assert.ok(out.includes('Promise.reject(new Error("node:fs is not available on Oxygen."))'));
    assert.ok(out.includes('Promise.reject(new Error("node:os is not available on Oxygen."))'));
    assert.ok(out.includes(`import('./local.js')`) && out.includes('import(variable)'));
    assert.ok(!/import\(\s*(\/\*.*?\*\/\s*)*['"]node:/.test(out));
  });
});

describe('removeEmptyDirs', () => {
  it('removes nested empty directories and keeps populated ones', async () => {
    const root = await tmp();
    await mkdir(join(root, 'a/b/c'), { recursive: true });
    await mkdir(join(root, 'keep/empty'), { recursive: true });
    await writeFile(join(root, 'keep/file.txt'), 'x');
    await removeEmptyDirs(root);
    assert.deepEqual((await readdir(root)).sort(), ['keep']);
    assert.deepEqual(await readdir(join(root, 'keep')), ['file.txt']);
  });
});

describe('bundleWorker', () => {
  it('inlines chunks into a single index.js with the process shim and removes leftovers', async () => {
    const root = await tmp();
    await put(root, {
      'index.js': `import { greet } from './chunks/a.js';\nexport default { fetch: () => new Response(greet()) };\n`,
      'chunks/a.js': `export const greet = () => 'hello';\n`,
    });
    await mkdir(join(root, 'empty/nested'), { recursive: true });
    await bundleWorker(pathToFileURL(root + '/'));

    assert.deepEqual(await readdir(root), ['index.js']);
    const code = await readFile(join(root, 'index.js'), 'utf8');
    assert.ok(code.replace(/\s+/g, ' ').startsWith(PROCESS_SHIM), code.slice(0, 80));
    assert.ok(code.includes('hello'));
    assert.ok(!code.includes('./chunks/a.js'));
  });

  it('removes chunks that tree-shaking left unreferenced, and keeps only index.js and its map', async () => {
    const root = await tmp();
    await put(root, {
      'index.js': `import { used } from './chunks/used.js';\nexport default { used };\n`,
      'index.js.map': '{}',
      'chunks/used.js': `export const used = 1;\nexport const unused = 2;\n`,
      'chunks/orphan.js': 'export const orphan = 3;\n',
      'chunks/deep/other.js': 'export const other = 4;\n',
      'oxygen.json': '{}',
      'stray.txt': 'x',
    });
    await bundleWorker(pathToFileURL(root + '/'));
    assert.deepEqual((await readdir(root)).sort(), ['index.js', 'index.js.map']);
  });

  it('cleans up through a symlinked worker dir', async () => {
    const root = await tmp();
    await put(root, {
      'real/index.js': `import { a } from './chunks/a.js';\nexport default { a };\n`,
      'real/chunks/a.js': 'export const a = 1;\n',
      'real/chunks/orphan.js': 'export const orphan = 2;\n',
    });
    await symlink(join(root, 'real'), join(root, 'link'));
    await bundleWorker(pathToFileURL(join(root, 'link') + '/'));
    assert.deepEqual(await readdir(join(root, 'real')), ['index.js']);
    assert.ok(!(await readFile(join(root, 'real/index.js'), 'utf8')).includes('./chunks/'));
  });

  it("resolves Astro's own dependencies from Astro's package, not from a conflicting hoisted copy", async () => {
    const root = await tmp();
    await put(root, {
      // The project hoisted an old `cookie` (as Express or Miniflare dependencies do) and npm nested
      // the one Astro needs. Astro's emitted chunk imports it bare, from dist/server.
      'node_modules/cookie/package.json': '{ "name": "cookie", "version": "0.5.0", "main": "index.js" }',
      'node_modules/cookie/index.js': 'exports.parse = () => "old-cookie";\n',
      'node_modules/astro/package.json': '{ "name": "astro", "version": "7.0.0", "dependencies": { "cookie": "^2.0.1" } }',
      'node_modules/astro/node_modules/cookie/package.json': '{ "name": "cookie", "version": "2.0.1", "type": "module", "exports": "./index.js" }',
      'node_modules/astro/node_modules/cookie/index.js': 'export const parseCookie = () => "astro-cookie";\n',
      // A package that is not an Astro dependency keeps resolving from the project.
      'node_modules/other/package.json': '{ "name": "other", "version": "1.0.0", "type": "module", "exports": "./index.js" }',
      'node_modules/other/index.js': 'export const other = "project-other";\n',
      'dist/server/index.js': `import { parseCookie } from 'cookie';\nimport { other } from 'other';\nexport default { parseCookie, other };\n`,
    });
    await bundleWorker(pathToFileURL(join(root, 'dist/server') + '/'));
    const code = await readFile(join(root, 'dist/server/index.js'), 'utf8');
    assert.ok(code.includes('astro-cookie'), code);
    assert.ok(!code.includes('old-cookie'));
    assert.ok(code.includes('project-other'));
  });

  it('keeps dynamic node: imports from failing the build by rejecting them at runtime', async () => {
    const root = await tmp();
    await put(root, { 'index.js': `export const load = () => import('node:stream');\n` });
    await bundleWorker(pathToFileURL(root + '/'));
    const code = await readFile(join(root, 'index.js'), 'utf8');
    assert.ok(code.includes('node:stream is not available on Oxygen.'));
  });

  it('fails listing static node: imports and removes the bundled file', async () => {
    const root = await tmp();
    await put(root, {
      'index.js': `import fs from 'node:fs';\nexport default fs;\n`,
      'chunks/keep.js': 'export {};\n',
    });
    await assert.rejects(bundleWorker(pathToFileURL(root + '/')), (error) => {
      assert.match(error.message, /Oxygen has no Node\.js built-in modules/);
      assert.ok(error.message.includes('node:fs'));
      return true;
    });
    assert.equal(existsSync(join(root, 'index.bundled.js')), false);
    assert.ok(existsSync(join(root, 'index.js')));
    assert.ok(existsSync(join(root, 'chunks/keep.js')));
  });
});

describe('miniOxygenDevPlugins', () => {
  it('returns the MiniOxygen plugins', () => {
    const plugins = miniOxygenDevPlugins({ env: { A: '1' } }, '2026-04-01');
    assert.ok(Array.isArray(plugins) && plugins.length > 0);
    assert.ok(plugins.some((plugin) => plugin.name === 'oxygen:main'));
  });
});
