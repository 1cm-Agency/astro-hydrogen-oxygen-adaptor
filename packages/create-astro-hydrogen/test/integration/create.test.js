// Needs network: installs the published astro-hydrogen and builds with it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { astroProject, cli, tempDir } from '../helpers.js';

const TIMEOUT = 10 * 60 * 1000;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}

function assertBuilt(dir) {
  run(npm, ['exec', '--no', '--', 'astro', 'build'], dir);
  assert.ok(existsSync(path.join(dir, 'dist/server/index.js')), 'dist/server/index.js');
  assert.ok(existsSync(path.join(dir, 'dist/server/oxygen.json')), 'dist/server/oxygen.json');
}

test('new mode installs and builds', { timeout: TIMEOUT }, (t) => {
  const root = tempDir(t);
  const result = cli(['shop', '--no-git', '--pm', 'npm'], { cwd: root });
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  const dir = path.join(root, 'shop');
  assert.ok(existsSync(path.join(dir, 'node_modules/astro-hydrogen')));
  assertBuilt(dir);
});

test('init mode installs and builds a minimal Astro project', { timeout: TIMEOUT }, (t) => {
  const dir = tempDir(t);
  astroProject(dir);
  const result = cli(['--pm', 'npm'], { cwd: dir });
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(existsSync(path.join(dir, 'package-lock.json')));
  assert.match(readFileSync(path.join(dir, 'astro.config.mjs'), 'utf8'), /adapter: hydrogen\(\)/);
  assertBuilt(dir);
});
