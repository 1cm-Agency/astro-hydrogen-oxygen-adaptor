import { existsSync, readFileSync } from 'node:fs';
import { readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { oxygen, type OxygenPlugin } from '@shopify/mini-oxygen/vite';
import type { AstroConfig, AstroIntegration } from 'astro';
import { passthroughImageService } from 'astro/config';
import { build as rolldownBuild } from 'rolldown';
import type { Plugin, PluginOption } from 'vite';

export type {
  HydrogenConfig,
  HydrogenLocals,
  HydrogenRequestArgs,
  HydrogenSessionManager,
  HydrogenStorefrontArgs,
  HydrogenStorefrontClient,
  OxygenEnv,
  OxygenRuntime,
} from './config.js';
export { defineHydrogenConfig } from './config.js';

export interface HydrogenAdapterOptions {
  /**
   * Inject Hydrogen's middleware, which puts a request-scoped Storefront client on
   * `Astro.locals.storefront` and serves Shopify routes and redirects. Set `false` to wire
   * Hydrogen yourself; the Oxygen adapter still works.
   * @default true
   */
  middleware?: boolean;
  /**
   * Module whose default export is a `defineHydrogenConfig()` object, relative to the project root.
   * @default the first of `src/hydrogen.config.{ts,mts,js,mjs}` that exists
   */
  configFile?: string;
  /**
   * Cache name for `caches.open()`, used for Hydrogen sub-request caching on Oxygen.
   * @default 'hydrogen'
   */
  cacheName?: string;
  /**
   * Workers compatibility date written to `oxygen.json` and used by MiniOxygen.
   * @default '2026-04-01'
   */
  compatibilityDate?: string;
  /** Options for the MiniOxygen runtime that runs `astro dev` and `astro preview`. */
  miniOxygen?: {
    /** Extra environment bindings. When set, `.env` files are not loaded automatically. */
    env?: Record<string, string>;
    /** Port for the Worker inspector (Chrome DevTools). */
    inspectorPort?: number;
    debug?: boolean;
  };
}

/** Options the preview entrypoint reads. Astro gives it no channel to the integration. */
export interface PreviewOptions {
  compatibilityDate: string;
  miniOxygen: HydrogenAdapterOptions['miniOxygen'];
}

const NAME = 'astro-hydrogen';
const DEFAULT_COMPATIBILITY_DATE = '2026-04-01';
const CONFIG_FILE_CANDIDATES = ['ts', 'mts', 'js', 'mjs'].map((ext) => `src/hydrogen.config.${ext}`);
const VIRTUAL_CONFIG = 'virtual:astro-hydrogen/config';
const VIRTUAL_OPTIONS = 'virtual:astro-hydrogen/options';
const WORKER_CONDITIONS = ['worker', 'workerd', 'module', 'browser', 'development|production'];

/**
 * Astro adapter that builds a Shopify Oxygen Worker and wires Hydrogen into every request.
 *
 * ```js
 * // astro.config.mjs
 * import hydrogen from 'astro-hydrogen';
 * export default defineConfig({ output: 'server', adapter: hydrogen() });
 * ```
 */
export default function hydrogen(options: HydrogenAdapterOptions = {}): AstroIntegration {
  const compatibilityDate = options.compatibilityDate ?? DEFAULT_COMPATIBILITY_DATE;
  let astroConfig: AstroConfig;

  return {
    name: NAME,
    hooks: {
      'astro:config:setup': ({ command, config, updateConfig, addMiddleware, addWatchFile, logger }) => {
        const root = fileURLToPath(config.root);

        const mode = config.vite?.mode ?? (command === 'dev' ? 'development' : 'production');
        if (command === 'build') loadDotEnvIntoProcess(root, mode);

        // Locally, `.env` stands in for the Oxygen environment variables; explicit options win.
        const miniOxygen = {
          ...options.miniOxygen,
          env: { ...readDotEnv(root, mode), ...options.miniOxygen?.env },
        };
        if (command === 'preview') {
          (globalThis as { __astroHydrogenPreview?: PreviewOptions }).__astroHydrogenPreview = {
            compatibilityDate,
            miniOxygen,
          };
        }

        // `shopify hydrogen deploy` sets this to the deployment's CDN folder before building.
        const assetBaseUrl = command === 'build' ? process.env.HYDROGEN_ASSET_BASE_URL || undefined : undefined;
        if (assetBaseUrl) logger.info(`Serving client assets from ${assetBaseUrl}`);

        const configFile = resolveConfigFile(root, options.configFile);
        if (configFile) addWatchFile(configFile);

        const plugins: PluginOption[] = [
          virtualModulesPlugin({ configFile, cacheName: options.cacheName ?? 'hydrogen', assetBaseUrl }),
          oxygenWorkerPlugin(),
        ];
        if (command === 'dev') plugins.push(miniOxygenDevPlugins(miniOxygen, compatibilityDate));

        const imageService = config.image.service;
        const runtimeImageService = 'runtime' in imageService ? imageService.runtime : imageService;
        const usesDefaultImageService = runtimeImageService.entrypoint === 'astro/assets/services/sharp';
        updateConfig({
          build: {
            // Oxygen expects `index.js` at the root of the Worker directory.
            serverEntry: 'index.js',
            ...(assetBaseUrl && !config.build.assetsPrefix && { assetsPrefix: assetBaseUrl.replace(/\/+$/, '') }),
          },
          // Sharp can't run in a Worker. Shopify's CDN resizes product images by URL instead.
          ...(usesDefaultImageService && { image: { service: passthroughImageService() } }),
          vite: { plugins },
        });

        if (options.middleware !== false) {
          addMiddleware({ entrypoint: `${NAME}/entrypoints/middleware`, order: 'pre' });
        }
      },

      'astro:config:done': ({ config, setAdapter, injectTypes }) => {
        astroConfig = config;
        injectTypes({ filename: 'types.d.ts', content: `/// <reference types="${NAME}/types.d.ts" />` });
        setAdapter({
          name: NAME,
          entrypointResolution: 'auto',
          serverEntrypoint: `${NAME}/entrypoints/server`,
          previewEntrypoint: `${NAME}/entrypoints/preview`,
          adapterFeatures: {
            // Oxygen always runs a Worker, even when every page is prerendered.
            buildOutput: 'server',
            middlewareMode: 'classic',
            preserveBuildClientDir: true,
            preserveBuildServerDir: true,
          },
          supportedAstroFeatures: {
            serverOutput: 'stable',
            hybridOutput: 'stable',
            staticOutput: 'stable',
            envGetSecret: 'stable',
            i18nDomains: 'experimental',
            sharpImageService: {
              support: 'limited',
              message: 'Sharp only runs at build time; on-demand pages use the passthrough image service on Oxygen.',
            },
          },
        });
      },

      'astro:build:done': async ({ logger }) => {
        const workerDir = astroConfig.build.server;
        await bundleWorker(workerDir);
        await writeFile(
          new URL('oxygen.json', workerDir),
          JSON.stringify({ version: 1, compatibility_date: compatibilityDate }, null, 2),
        );
        logger.info(
          `Oxygen Worker: ${relativeToRoot(workerDir)}, assets: ${relativeToRoot(astroConfig.build.client)}. ` +
            `Deploy with \`shopify hydrogen deploy --worker-dir ${relativeToRoot(workerDir)} --assets-dir ${relativeToRoot(astroConfig.build.client)}\``,
        );
      },
    },
  };

  function relativeToRoot(url: URL): string {
    const path = fileURLToPath(url).slice(fileURLToPath(astroConfig.root).length).replace(/\/+$/, '');
    return path || '.';
  }
}

/**
 * Prerendering runs in Node at build time, with no Worker env. Expose `.env` values through
 * `process.env` so the middleware can still reach the store, as Oxygen's bindings would at runtime.
 */
function loadDotEnvIntoProcess(root: string, mode: string) {
  for (const [key, value] of Object.entries(readDotEnv(root, mode))) {
    process.env[key] ??= value;
  }
}

/**
 * Reads only the `.env` files, in Vite's precedence order. Unlike Vite's `loadEnv` with an empty
 * prefix, this leaves out the shell's own environment, which has no place in the Worker's `env`.
 */
function readDotEnv(root: string, mode: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const file of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    const path = join(root, file);
    if (existsSync(path)) Object.assign(env, parseEnv(readFileSync(path, 'utf8')));
  }
  return env;
}

function resolveConfigFile(root: string, configFile: string | undefined): string | undefined {
  if (configFile) {
    const path = isAbsolute(configFile) ? configFile : resolve(root, configFile);
    if (!existsSync(path)) throw new Error(`[${NAME}] configFile not found: ${path}`);
    return path;
  }
  return CONFIG_FILE_CANDIDATES.map((candidate) => resolve(root, candidate)).find((path) => existsSync(path));
}

function virtualModulesPlugin(values: {
  configFile: string | undefined;
  cacheName: string;
  assetBaseUrl: string | undefined;
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
          `export const assetBaseUrl = ${JSON.stringify(values.assetBaseUrl)};`,
        ].join('\n');
      }
    },
  };
}

/** Resolves the `ssr` environment for Workers and bundles every dependency into it. */
function oxygenWorkerPlugin(): Plugin {
  return {
    name: `${NAME}:worker`,
    configEnvironment(name) {
      if (name !== 'ssr') return;
      return { resolve: { conditions: WORKER_CONDITIONS, noExternal: true } };
    },
  };
}

/**
 * Oxygen runs one Worker module. Astro's SSR build emits an entry plus chunks (and post-processes
 * them), so once it is done, inline the chunks into `index.js` and remove them.
 */
async function bundleWorker(workerDir: URL) {
  const entry = fileURLToPath(new URL('index.js', workerDir));
  const bundled = fileURLToPath(new URL('index.bundled.js', workerDir));

  const output = await rolldownBuild({
    input: entry,
    platform: 'neutral',
    external: [/^node:/, /^cloudflare:/],
    logLevel: 'warn',
    output: { file: bundled, format: 'esm', codeSplitting: false },
  });

  const workerDirPath = fileURLToPath(workerDir);
  const inlinedFiles = output.output
    .flatMap((chunk) => (chunk.type === 'chunk' ? chunk.moduleIds : []))
    .filter((id) => id.startsWith(workerDirPath));
  await Promise.all(inlinedFiles.map((file) => rm(file, { force: true })));
  await rename(bundled, entry);
  await removeEmptyDirs(workerDirPath);
}

async function removeEmptyDirs(dir: string) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    await removeEmptyDirs(path);
    if ((await readdir(path)).length === 0) await rmdir(path);
  }
}

/** Runs the `ssr` environment inside MiniOxygen (workerd) during `astro dev`. */
function miniOxygenDevPlugins(
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
