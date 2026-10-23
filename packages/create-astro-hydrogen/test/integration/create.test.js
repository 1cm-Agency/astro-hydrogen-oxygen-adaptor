// Needs network for the other dependencies. The adapter itself is installed from a pack of this
// checkout, not from the registry: the release gate runs before the version the template pins
// exists on npm, and this way the test covers the adapter that is about to be published.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { astroProject, cli, tempDir } from '../helpers.js';

const TIMEOUT = 10 * 60 * 1000;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const ADAPTER_DIR = fileURLToPath(new URL('../../../astro-hydrogen/', import.meta.url));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}

let adapterTarball;
before((t) => {
  const dir = tempDir(t);
  run(npm, ['pack', ADAPTER_DIR, '--pack-destination', dir, '--silent'], dir);
  adapterTarball = path.join(dir, readdirSync(dir).find((name) => name.endsWith('.tgz')));
});

// `npm install <tarball>` installs everything in package.json plus the packed adapter in place of
// the registry version the template or init mode wrote.
function installAndBuild(dir) {
  run(npm, ['install', adapterTarball, '--no-audit', '--no-fund'], dir);
  assert.ok(existsSync(path.join(dir, 'node_modules/astro-hydrogen/dist/index.js')), 'adapter installed');
  run(npm, ['exec', '--no', '--', 'astro', 'build'], dir);
  assert.ok(existsSync(path.join(dir, 'dist/server/index.js')), 'dist/server/index.js');
  assert.ok(existsSync(path.join(dir, 'dist/server/oxygen.json')), 'dist/server/oxygen.json');
}

test('new mode scaffolds a project that installs and builds', { timeout: TIMEOUT }, (t) => {
  const root = tempDir(t);
  const result = cli(['shop', '--no-git', '--no-install'], { cwd: root });
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  installAndBuild(path.join(root, 'shop'));
});

test('init mode turns a minimal Astro project into one that installs and builds', { timeout: TIMEOUT }, (t) => {
  const dir = tempDir(t);
  astroProject(dir);
  const result = cli(['--no-install'], { cwd: dir });
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(readFileSync(path.join(dir, 'astro.config.mjs'), 'utf8'), /adapter: hydrogen\(\)/);
  installAndBuild(dir);
});
