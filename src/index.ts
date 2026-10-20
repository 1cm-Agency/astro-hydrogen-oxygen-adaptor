import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AstroConfig, AstroIntegration } from 'astro';
import { passthroughImageService } from 'astro/config';
import type { PluginOption } from 'vite';
import {
  bundleWorker,
  isPrerendered404,
  loadDotEnvIntoProcess,
  miniOxygenDevPlugins,
  oxygenWorkerPlugin,
  readDotEnv,
  resolveConfigFile,
  singleHydrogenBuildPlugin,
  virtualModulesPlugin,
  type RouteState,
} from './build.js';

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
    /** Extra environment bindings, merged over the values from `.env` files; these win. */
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
  const routes: RouteState = { prerendered404: false };

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
          virtualModulesPlugin({
            configFile,
            cacheName: options.cacheName ?? 'hydrogen',
            assetBaseUrl,
            base: config.base,
            middleware: options.middleware !== false,
            routes,
          }),
          oxygenWorkerPlugin(root),
          singleHydrogenBuildPlugin(root),
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
          image: {
            // Sharp can't run in a Worker. Shopify's CDN resizes product images by URL instead.
            ...(usesDefaultImageService && { service: passthroughImageService() }),
            // Astro's dev image endpoint reads files with `node:fs`; the generic one, used in
            // production, fetches them, which also works in workerd.
            ...(command === 'dev' &&
              !config.image.endpoint.entrypoint && {
                endpoint: { ...config.image.endpoint, entrypoint: 'astro/assets/endpoint/generic' },
              }),
          },
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

      // Runs when Astro builds its route list: before the build bundles the Worker, and before
      // `astro dev` serves its first request. The virtual options module reads the result lazily.
      'astro:routes:resolved': ({ routes: resolved }) => {
        routes.prerendered404 = isPrerendered404(resolved);
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

