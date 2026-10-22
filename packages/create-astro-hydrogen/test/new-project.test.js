import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { listFiles } from '../src/fs.js';
import { toPackageName } from '../src/new-project.js';
import { cli, tempDir, write } from './helpers.js';

test('derives a package name from the directory name', () => {
  assert.equal(toPackageName('My Shop!'), 'my-shop');
  assert.equal(toPackageName('already-fine_1.0'), 'already-fine_1.0');
  assert.equal(toPackageName('Ünï Store'), 'n-store');
  assert.equal(toPackageName('.hidden'), 'hidden');
  assert.equal(toPackageName('!!!'), 'astro-hydrogen-app');
});

test('new mode scaffolds the template', (t) => {
  const root = tempDir(t);
  const result = cli(['My Shop!', '--no-install', '--no-git'], { cwd: root });
  assert.equal(result.code, 0, result.stderr);

  const dir = path.join(root, 'My Shop!');
  const files = listFiles(dir);
  for (const expected of [
    '.env.example',
    '.gitignore',
    'README.md',
    'astro.config.mjs',
    'package.json',
    'public/favicon.svg',
    'src/hydrogen.config.ts',
    'src/pages/cart.astro',
    'src/pages/index.astro',
    'src/pages/products/[handle].astro',
    'tsconfig.json',
  ]) {
    assert.ok(files.includes(expected), `missing ${expected}`);
  }
  assert.ok(!files.includes('_gitignore'));
  assert.ok(!files.some((f) => f.startsWith('node_modules') || f.startsWith('dist') || f.startsWith('.astro')));
  assert.ok(!existsSync(path.join(dir, '.git')));
  assert.match(readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^node_modules\/$/m);

  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'my-shop');
  assert.equal(pkg.dependencies['astro-hydrogen'], '^0.1.0');
  assert.equal(pkg.dependencies.astro, '^7.4.0');
  assert.match(pkg.scripts.deploy, /shopify hydrogen deploy/);
  for (const file of files) {
    assert.ok(!readFileSync(path.join(dir, file), 'utf8').includes('{{name}}'), `${file} still has {{name}}`);
  }
  assert.match(result.stdout, /cd My Shop!|cd "My Shop!"/);
  assert.match(result.stdout, /npm run dev/);
  assert.match(result.stdout, /mock\.shop/);
});

test('new mode prints next steps for the package manager in use', (t) => {
  const root = tempDir(t);
  const result = cli(['site', '--no-install', '--no-git'], { cwd: root, env: { npm_config_user_agent: 'pnpm/9.12.0 npm/? node/v22' } });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^ {2}pnpm install$/m);
  assert.match(result.stdout, /^ {2}pnpm dev$/m);
  assert.match(result.stdout, /pnpm build && pnpm deploy/);
});

test('new mode accepts an existing empty directory', (t) => {
  const root = tempDir(t);
  const result = cli(['.', '--no-install', '--no-git', '--pm', 'bun'], { cwd: root });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(existsSync(path.join(root, 'package.json')));
  assert.match(result.stdout, /bun run dev/);
});

test('new mode refuses a non-empty, non-Astro directory', (t) => {
  const root = tempDir(t);
  write(root, 'notes.txt', 'hello');
  const result = cli([root, '--no-install', '--no-git']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not empty and is not an Astro project/);
  assert.deepEqual(listFiles(root), ['notes.txt']);
});

test('prints usage and exits 1 without a directory outside an Astro project', (t) => {
  const result = cli([], { cwd: tempDir(t) });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Usage: create-astro-hydrogen/);
});

test('rejects an unknown package manager and prints help', (t) => {
  assert.equal(cli(['x', '--pm', 'deno'], { cwd: tempDir(t) }).code, 1);
  const help = cli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /--no-install/);
});
