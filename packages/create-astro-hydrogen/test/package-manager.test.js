import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectPackageManager, packageManagerFromUserAgent, runScript } from '../src/package-manager.js';
import { tempDir, write } from './helpers.js';

test('detects the package manager from npm_config_user_agent', () => {
  const agents = {
    'npm/10.9.0 node/v22.12.0 darwin arm64 workspaces/false': 'npm',
    'pnpm/9.12.0 npm/? node/v22.12.0 darwin arm64': 'pnpm',
    'yarn/4.5.0 npm/? node/v22.12.0 darwin arm64': 'yarn',
    'bun/1.1.30 npm/? node/v22.12.0 darwin arm64': 'bun',
  };
  for (const [agent, pm] of Object.entries(agents)) assert.equal(packageManagerFromUserAgent(agent), pm);
  assert.equal(packageManagerFromUserAgent(undefined), null);
  assert.equal(packageManagerFromUserAgent('deno/2.0'), null);
});

test('--pm wins over the user agent, which wins over lockfiles', (t) => {
  const dir = tempDir(t);
  write(dir, 'yarn.lock', '');
  assert.equal(detectPackageManager({ flag: 'bun', userAgent: 'pnpm/9.0.0', dir }), 'bun');
  assert.equal(detectPackageManager({ userAgent: 'pnpm/9.0.0 npm/?', dir }), 'pnpm');
  assert.equal(detectPackageManager({ dir }), 'yarn');
});

test('detects the package manager from lockfiles, falling back to npm', (t) => {
  const locks = { 'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn', 'bun.lock': 'bun', 'bun.lockb': 'bun', 'package-lock.json': 'npm' };
  for (const [file, pm] of Object.entries(locks)) {
    const dir = tempDir(t);
    write(dir, file, '');
    assert.equal(detectPackageManager({ dir }), pm, file);
  }
  assert.equal(detectPackageManager({ dir: tempDir(t) }), 'npm');
  assert.equal(detectPackageManager({}), 'npm');
});

test('prints run commands the way each package manager expects', () => {
  assert.equal(runScript('npm', 'dev'), 'npm run dev');
  assert.equal(runScript('pnpm', 'dev'), 'pnpm dev');
  assert.equal(runScript('yarn', 'dev'), 'yarn dev');
  assert.equal(runScript('bun', 'dev'), 'bun run dev');
});
