import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readdir, realpath, rename, rm, rmdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { oxygen, type OxygenPlugin } from '@shopify/mini-oxygen/vite';
import { build as rolldownBuild, type Plugin as RolldownPlugin } from 'rolldown';
import type { Plugin } from 'vite';
import type { HydrogenAdapterOptions } from './index.js';

const NAME = 'astro-hydrogen';
export const CONFIG_FILE_CANDIDATES = ['ts', 'mts', 'js', 'mjs'].map((ext) => `src/hydrogen.config.${ext}`);
const VIRTUAL_CONFIG = 'virtual:astro-hydrogen/config';
const VIRTUAL_OPTIONS = 'virtual:astro-hydrogen/options';
// Oxygen has no `process` global, and some dependencies read `process.env.X` or
// `process.platform` while their module evaluates. Only `process.env.NODE_ENV` is replaced at build time.
export const PROCESS_SHIM = 'globalThis.process ??= {}; globalThis.process.env ??= {};';
const WORKER_CONDITIONS = ['worker', 'workerd', 'module', 'browser', 'development|production'];

/**
 * Prerendering runs in Node at build time, with no Worker env. Expose `.env` values through
 * `process.env` so the middleware can still reach the store, as Oxygen's bindings would at runtime.
 */
export function loadDotEnvIntoProcess(root: string, mode: string) {
  for (const [key, value] of Object.entries(readDotEnv(root, mode))) {
    process.env[key] ??= value;
  }
}

/**
 * Reads only the `.env` files, in Vite's precedence order. Unlike Vite's `loadEnv` with an empty
 * prefix, this leaves out the shell's own environment, which has no place in the Worker's `env`.
 */
export function readDotEnv(root: string, mode: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const file of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    const path = join(root, file);
    if (existsSync(path)) Object.assign(env, parseEnv(readFileSync(path, 'utf8')));
  }
  return env;
}

export function resolveConfigFile(root: string, configFile: string | undefined): string | undefined {
  if (configFile) {
    const path = isAbsolute(configFile) ? configFile : resolve(root, configFile);
    if (!existsSync(path)) throw new Error(`[${NAME}] configFile not found: ${path}`);
    return path;
  }
  return CONFIG_FILE_CANDIDATES.map((candidate) => resolve(root, candidate)).find((path) => existsSync(path));
}

/** Facts about the project's routes, recorded by the `astro:routes:resolved` hook. */
export interface RouteState {
  prerendered404: boolean;
}

/** True when the project has a `/404` route that Astro prerenders to a static file. */
export function isPrerendered404(routes: ReadonlyArray<{ pattern: string; isPrerendered: boolean }>): boolean {
  return routes.some((route) => route.pattern === '/404' && route.isPrerendered);
}

export function virtualModulesPlugin(values: {
  configFile: string | undefined;
  cacheName: string;
  assetBaseUrl: string | undefined;
  base: string;
  /** Whether the adapter's middleware is injected. */
  middleware: boolean;
  /** Read when the options module loads, after `astro:routes:resolved` has filled it in. */
  routes: RouteState;
}): Plugin {
  const resolved = (id: string) => `\0${id}`;
  return {
    name: `${NAME}:virtual`,
    resolveId(id) {
      if (id === VIRTUAL_CONFIG || id === VIRTUAL_OPTIONS) return resolved(id);
    },
    load(id) {
      if (id === resolved(VIRTUAL_CONFIG)) {
        return values.configFile
          ? `export { default } from ${JSON.stringify(values.configFile)};`
          : 'export default {};';
      }
      if (id === resolved(VIRTUAL_OPTIONS)) {
        return [
          `export const cacheName = ${JSON.stringify(values.cacheName)};`,
          `export const base = ${JSON.stringify(values.base.replace(/\/+$/, ''))};`,
          `export const assetBaseUrl = ${JSON.stringify(values.assetBaseUrl)};`,
          `export const middleware = ${values.middleware};`,
          `export const prerendered404 = ${values.routes.prerendered404};`,
        ].join('\n');
      }
    },
  };
}

/**
 * CommonJS packages the server loads in dev. workerd runs only ES modules, and MiniOxygen does not
 * pre-bundle server dependencies by itself, so list them here; uninstalled ones are skipped.
 * `a > b` is Vite's syntax for `b` as resolved from `a`.
 */
export const COMMONJS_SERVER_DEPS = [
  'astro > picomatch',
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/server',
];

export function installedDeps(root: string, specifiers: string[]): string[] {
  return specifiers.filter((specifier) => {
    let from = join(root, 'package.json');
    try {
      for (const id of specifier.split(' > ')) {
        from = createRequire(from).resolve(id.includes('/') ? id : `${id}/package.json`);
      }
      return true;
    } catch {
      return false;
    }
  });
}

/** Resolves the `ssr` environment for Workers and bundles every dependency into it. */
export function oxygenWorkerPlugin(root: string): Plugin {
  return {
    name: `${NAME}:worker`,
    configEnvironment(name, _options, { mode, command }) {
      if (name !== 'ssr') return;
      return {
        resolve: { conditions: WORKER_CONDITIONS, noExternal: true },
        // Workers have no `process`; CommonJS packages such as React branch on this at load time.
        define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development') },
        ...(command === 'serve' && { optimizeDeps: { include: installedDeps(root, COMMONJS_SERVER_DEPS) } }),
      };
    },
  };
}

/**
 * `@shopify/hydrogen`'s main export has a `development` condition, but its sub-paths such as
 * `./customer-account` do not. In `astro dev`, Vite's `development` condition would therefore load
 * two copies of Hydrogen's core on the server, and `createCustomerAccountServerHandlers` would not
 * recognise cart handlers created by the other copy. Resolve the main entry the way Node does,
 * without the `development` condition, so the server runs one build of Hydrogen.
 */
export function singleHydrogenBuildPlugin(root: string): Plugin {
  const require = createRequire(join(root, 'package.json'));
  return {
    name: `${NAME}:single-hydrogen-build`,
    apply: 'serve',
    enforce: 'pre',
    applyToEnvironment: (environment) => environment.name === 'ssr',
    resolveId(id) {
      if (id !== '@shopify/hydrogen') return;
      try {
        return require.resolve(id);
      } catch {
        return;
      }
    },
  };
}

/**
 * Oxygen runs one Worker module. Astro's SSR build emits an entry plus chunks (and post-processes
 * them), so once it is done, inline the chunks into `index.js` and remove them.
 */
export async function bundleWorker(workerDir: URL) {
  const entry = fileURLToPath(new URL('index.js', workerDir));
  const bundled = fileURLToPath(new URL('index.bundled.js', workerDir));

  const workerDirPath = await realpath(fileURLToPath(workerDir));
  const staticNodeImports = new Set<string>();
  const output = await rolldownBuild({
    input: entry,
    platform: 'neutral',
    external: [/^cloudflare:/],
    logLevel: 'warn',
    plugins: [nodeBuiltinsPlugin(staticNodeImports), astroDependenciesPlugin([workerDirPath, fileURLToPath(workerDir)])],
    output: { file: bundled, format: 'esm', codeSplitting: false, banner: PROCESS_SHIM },
  });
  if (staticNodeImports.size > 0) {
    await rm(bundled, { force: true });
    throw new Error(
      `Oxygen has no Node.js built-in modules, but the Worker imports:\n  ${[...staticNodeImports].join('\n  ')}\n` +
        'Use a Web-compatible alternative for these dependencies.',
    );
  }

  await rename(bundled, entry);
  // Oxygen uploads only `index.js` (and its source map) from the worker dir, so whatever else is
  // there is a chunk that is now inlined, or one that tree-shaking left unreferenced.
  for (const name of await readdir(workerDirPath)) {
    if (name !== 'index.js' && name !== 'index.js.map') await rm(join(workerDirPath, name), { recursive: true, force: true });
  }
}

/**
 * Astro's server build leaves Astro's own dependencies as bare imports in the emitted chunks
 * (`cookie`, `clsx`, `devalue`, ...). Bundling from the chunk's location resolves them from the
 * project's `node_modules`, which is the wrong copy whenever npm hoisted another major of the same
 * package there (an old `cookie` from an Express or Miniflare dependency, for example) and nested
 * Astro's copy under `node_modules/astro`. Resolve those imports from Astro's package instead, as
 * Node would have for Astro's own source files.
 */
export function astroDependenciesPlugin(workerDirs: string[]): RolldownPlugin {
  let astroPackage: string | undefined;
  let astroDependencies = new Set<string>();
  try {
    astroPackage = createRequire(join(workerDirs[0], 'index.js')).resolve('astro/package.json');
    const { dependencies = {} } = JSON.parse(readFileSync(astroPackage, 'utf8')) as { dependencies?: Record<string, string> };
    astroDependencies = new Set(Object.keys(dependencies));
  } catch {
    // No Astro next to the worker dir (unit tests of the bundler): nothing to redirect.
  }
  return {
    name: 'astro-hydrogen:astro-dependencies',
    async resolveId(id, importer, options) {
      if (!astroPackage || !importer || !workerDirs.some((dir) => importer.startsWith(dir))) return;
      if (!astroDependencies.has(packageNameOf(id))) return;
      const resolved = await this.resolve(id, astroPackage, { ...options, skipSelf: true });
      return resolved ?? undefined;
    },
  };
}

/** `@scope/name/sub` -> `@scope/name`, `name/sub` -> `name`; '' for anything that is not a bare specifier. */
export function packageNameOf(id: string): string {
  if (id.startsWith('.') || id.startsWith('/') || id.startsWith('\0') || /^[a-z]+:/i.test(id)) return '';
  const parts = id.split('/');
  return id.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// `import("node:x")`, including with `/* @vite-ignore */`-style comments, which Rolldown leaves alone.
export const DYNAMIC_NODE_IMPORT = /\bimport\(\s*(?:\/\*[\s\S]*?\*\/\s*)*(["'])(node:[^"']+)\1\s*\)/g;

/**
 * Oxygen runs with no compatibility flags, so `node:*` modules do not exist there, and workerd
 * refuses to start a Worker that references a module it cannot resolve, even one that is only
 * imported dynamically. Dependencies often keep a Node fallback behind `await import('node:…')`
 * (`@astrojs/react` does, for `node:stream`), so turn those into rejected promises, and collect
 * static imports, which would always fail, to report them.
 */
export function nodeBuiltinsPlugin(staticNodeImports: Set<string>): RolldownPlugin {
  return {
    name: 'astro-hydrogen:node-builtins',
    resolveId(id, importer, { kind }) {
      if (!id.startsWith('node:')) return;
      if (kind !== 'dynamic-import') staticNodeImports.add(importer ? `${id} (from ${importer})` : id);
      return { id, external: true };
    },
    renderChunk(code) {
      if (!code.includes('node:')) return;
      return code.replace(DYNAMIC_NODE_IMPORT, (_, _quote, id: string) =>
        `Promise.reject(new Error(${JSON.stringify(`${id} is not available on Oxygen.`)}))`,
      );
    },
  };
}

export async function removeEmptyDirs(dir: string) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    await removeEmptyDirs(path);
    if ((await readdir(path)).length === 0) await rmdir(path);
  }
}

/** Runs the `ssr` environment inside MiniOxygen (workerd) during `astro dev`. */
export function miniOxygenDevPlugins(
  miniOxygen: NonNullable<HydrogenAdapterOptions['miniOxygen']>,
  compatibilityDate: string,
): Plugin[] {
  const plugins = oxygen({
    entry: fileURLToPath(new URL('./entrypoints/server.js', import.meta.url)),
    env: miniOxygen.env,
    inspectorPort: miniOxygen.inspectorPort,
    debug: miniOxygen.debug,
  });
  const main = plugins.find((plugin) => plugin.name === 'oxygen:main') as OxygenPlugin | undefined;
  main?.api?.registerPluginOptions({ compatibilityDate });
  return plugins;
}
