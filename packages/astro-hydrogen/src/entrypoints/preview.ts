/**
 * `astro preview`: serves the built Worker in MiniOxygen with the client assets on a simulated
 * Oxygen CDN, so preview behaves like a deployment.
 */
import { fileURLToPath } from 'node:url';
import { oxygen, type OxygenPlugin } from '@shopify/mini-oxygen/vite';
import type { CreatePreviewServer } from 'astro';
import { preview } from 'vite';
import type { PreviewOptions } from '../index.js';

const createPreviewServer: CreatePreviewServer = async ({
  root,
  client,
  server,
  base,
  host,
  port,
  headers,
  allowedHosts,
  open,
  logger,
}) => {
  const options = (globalThis as { __astroHydrogenPreview?: PreviewOptions }).__astroHydrogenPreview;
  const plugins = oxygen({
    previewEntry: fileURLToPath(new URL('index.js', server)),
    env: options?.miniOxygen?.env,
    inspectorPort: options?.miniOxygen?.inspectorPort,
    debug: options?.miniOxygen?.debug,
  });
  const main = plugins.find((plugin) => plugin.name === 'oxygen:main') as OxygenPlugin | undefined;
  if (options) main?.api?.registerPluginOptions({ compatibilityDate: options.compatibilityDate });

  const previewServer = await preview({
    configFile: false,
    root: fileURLToPath(root),
    base,
    // No HTML fallback: extensionless page URLs must reach the Worker, as on Oxygen.
    appType: 'custom',
    build: { outDir: fileURLToPath(client) },
    preview: { host, port, headers, open: open ?? false, allowedHosts },
    plugins,
  });

  const address = previewServer.resolvedUrls?.local[0];
  if (address) logger.info(`Oxygen preview running at ${address}`);

  return {
    host,
    port,
    server: previewServer.httpServer,
    closed: () =>
      new Promise<void>((resolveClosed, reject) => {
        previewServer.httpServer.once('close', () => resolveClosed());
        previewServer.httpServer.once('error', reject);
      }),
    stop: () => previewServer.close(),
  };
};

export default createPreviewServer;
