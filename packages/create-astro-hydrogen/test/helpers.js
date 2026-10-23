import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN = fileURLToPath(new URL('../bin/create-astro-hydrogen.js', import.meta.url));
// The range the template pins; it follows the adapter version, so tests must not hardcode it.
export const ADAPTER_RANGE = `^${JSON.parse(readFileSync(new URL('../../astro-hydrogen/package.json', import.meta.url), 'utf8')).version}`;

export function tempDir(t, prefix = 'create-astro-hydrogen-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function cli(args, { cwd, env = {} } = {}) {
  const base = { ...process.env };
  delete base.npm_config_user_agent;
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...base, ...env },
    encoding: 'utf8',
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function write(dir, file, contents) {
  const full = path.join(dir, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

// A minimal Astro project, as `npm create astro` would leave it.
export function astroProject(dir, { config = "import { defineConfig } from 'astro/config';\n\nexport default defineConfig({ integrations: [] });\n", configName = 'astro.config.mjs' } = {}) {
  write(dir, 'package.json', `${JSON.stringify({ name: 'site', type: 'module', scripts: { dev: 'astro dev' }, dependencies: { astro: '^7.4.0' } }, null, 2)}\n`);
  if (config !== null) write(dir, configName, config);
  write(dir, 'src/pages/index.astro', '<h1>Hi</h1>\n');
}
