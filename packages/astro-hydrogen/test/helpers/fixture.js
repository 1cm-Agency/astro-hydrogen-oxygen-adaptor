/**
 * Builds a fixture project with Astro's programmatic API and drives the resulting Worker in
 * MiniOxygen (workerd), the way the repo-level `test/oxygen-worker.test.mjs` does for the example storefront.
 *
 *   const site = await buildFixture('minimal', { cdn: true, env: { SESSION_SECRET: '...' } });
 *   const res = await site.fetch('/api/cart');
 *   await site.dispose();
 *
 * Builds are cached per (fixture, mode) for the life of the test process, and each build goes to its
 * own `dist/<mode>-<pid>` folder so test files running in parallel never share output.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';
import { buildAssetsUrl, createMiniOxygen, Request } from '@shopify/mini-oxygen';

// MiniOxygen forwards the Worker's console to this process's console. Collect those lines so tests
// can assert on them (`site.logs`, `site.waitForLog`) and keep them out of the test report. Also quiet
// two expected lines: the mock.shop notice (build and prerender run in this process) and MiniOxygen's
// per-request line from `astro preview`.
const workerLogs = [];
const NOISE = [/^\[astro-hydrogen\] PUBLIC_STORE_DOMAIN is not set/, /^(GET|POST|HEAD|PUT|DELETE)\s+\d{3}\s/];
for (const level of ['log', 'warn', 'info', 'error', 'debug']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    if (new Error().stack.includes('mini-oxygen/dist/worker/logger')) {
      workerLogs.push(args.map(String).join(' '));
      return;
    }
    if (typeof args[0] === 'string' && NOISE.some((pattern) => pattern.test(args[0]))) return;
    original(...args);
  };
}

export const ORIGIN = 'http://shop.test';
const FIXTURES = new URL('../fixtures/', import.meta.url);
const PORT_RANGE = [4480, 4499];
/** `astro dev` servers use their own range, so they cannot take a port a CDN assets server needs. */
export const DEV_PORT_RANGE = [4500, 4519];

/** Absolute path of a fixture directory (no trailing slash). An absolute `name` is used as is. */
export function pathOf(name) {
  if (name.startsWith('/')) return name.replace(/\/$/, '');
  return fileURLToPath(new URL(`${name}/`, FIXTURES)).replace(/\/$/, '');
}

/** A free TCP port in 4480-4499 (or `range`), starting from a random offset so parallel test files rarely collide. */
export async function freePort(range = PORT_RANGE) {
  const [min, max] = range;
  const size = max - min + 1;
  const start = Math.floor(Math.random() * size);
  for (let i = 0; i < size; i++) {
    const port = min + ((start + i) % size);
    if ((await isFree(port)) && claim(port)) return port;
  }
  throw new Error(`No free port in ${min}-${max}`);
}

/**
 * Test files run in parallel processes, and a port that is free now may be taken by the time its
 * server starts. A lock file per port, owned by this process, closes that gap (stale ones are reclaimed).
 */
function claim(port) {
  const lock = `${tmpdir()}/astro-hydrogen-test-port-${port}.lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' });
      process.on('exit', () => rmSync(lock, { force: true }));
      return true;
    } catch {
      try {
        process.kill(Number(readFileSync(lock, 'utf8')), 0);
        return false;
      } catch (error) {
        if (error.code === 'EPERM') return false;
        rmSync(lock, { force: true });
      }
    }
  }
  return false;
}

function isFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/** Build output directories created by this process, removed on exit. */
const outDirs = new Set();
process.on('exit', () => {
  for (const dir of outDirs) rmSync(dir, { recursive: true, force: true });
});

const builds = new Map();

/**
 * Builds the fixture, unless this process already did, and starts a Worker for it.
 * @param {string} name fixture directory under test/fixtures
 * @param {{ cdn?: boolean, env?: Record<string, string> }} [options]
 *   `cdn` bakes `HYDROGEN_ASSET_BASE_URL` in and serves the client directory from a simulated Oxygen
 *   CDN (what `shopify hydrogen deploy` does). Without it, prerendered pages cannot be found at runtime.
 *   `env` becomes the Worker's bindings.
 */
export async function buildFixture(name, { cdn = false, env = {} } = {}) {
  const key = `${name}:${cdn ? 'cdn' : 'plain'}`;
  let entry = builds.get(key);
  if (!entry) {
    entry = buildOnly(name, { cdn });
    builds.set(key, entry);
  }
  const built = await entry;
  return startWorker(built, env);
}

/** Runs `astro build` for the fixture and resolves with its paths. Rejects with the build error. */
export async function buildOnly(name, { cdn = false, logLevel = 'error' } = {}) {
  const root = pathOf(name);
  const outDir = `dist/${cdn ? 'cdn' : 'plain'}-${process.pid}`;
  const dist = `${root}/${outDir}`;
  outDirs.add(dist);
  const port = cdn ? await freePort() : undefined;
  const previous = process.env.HYDROGEN_ASSET_BASE_URL;
  if (cdn) process.env.HYDROGEN_ASSET_BASE_URL = buildAssetsUrl(port);
  else delete process.env.HYDROGEN_ASSET_BASE_URL;
  try {
    await build({ root, outDir, logLevel });
  } finally {
    if (previous === undefined) delete process.env.HYDROGEN_ASSET_BASE_URL;
    else process.env.HYDROGEN_ASSET_BASE_URL = previous;
  }
  return { name, root, outDir, dist, cdn, port };
}

async function startWorker(built, env) {
  const workerDir = `${built.dist}/server`;
  const workerFile = `${workerDir}/index.js`;
  const miniOxygen = createMiniOxygen({
    // The assets server binds a fixed port: only one live Worker per CDN build.
    ...(built.cdn && { assets: { directory: `${built.dist}/client`, port: built.port } }),
    requestHook: null,
    workers: [
      {
        name: 'storefront',
        modulesRoot: workerDir,
        modules: [{ type: 'ESModule', path: workerFile, contents: readFileSync(workerFile, 'utf8') }],
        compatibilityDate: JSON.parse(readFileSync(`${workerDir}/oxygen.json`, 'utf8')).compatibility_date,
        bindings: env,
      },
    ],
  });
  await miniOxygen.ready;

  let disposed = false;
  return {
    root: built.root,
    dist: built.dist,
    /** Base URL baked into the build in CDN mode. */
    assetsUrl: built.cdn ? buildAssetsUrl(built.port) : undefined,
    /** Everything any Worker in this process wrote to its console so far, one line per call. */
    get logs() {
      return workerLogs.join('\n');
    },
    /** Resolves once the Worker's console output matches `pattern` (it arrives asynchronously). */
    async waitForLog(pattern, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (!pattern.test(workerLogs.join('\n'))) {
        if (Date.now() > deadline) throw new Error(`Worker logs never matched ${pattern}:\n${workerLogs.join('\n')}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    /** Fetch a path from the Worker. Redirects are not followed. */
    fetch(path, init) {
      // Miniflare drops the method and body of a plain init object; pass its own Request instead.
      return miniOxygen.dispatchFetch(new Request(`${ORIGIN}${path}`, { redirect: 'manual', ...init }));
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await miniOxygen.dispose();
    },
  };
}
