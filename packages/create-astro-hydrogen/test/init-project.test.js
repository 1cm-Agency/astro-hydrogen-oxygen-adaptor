import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { listFiles } from '../src/fs.js';
import { astroProject, cli, tempDir, write } from './helpers.js';

const read = (dir, file) => readFileSync(path.join(dir, file), 'utf8');
const snapshot = (dir) => Object.fromEntries(listFiles(dir).map((f) => [f, read(dir, f)]));

test('init mode adds the adapter to an Astro project, twice without changes', (t) => {
  const dir = tempDir(t);
  astroProject(dir);

  const first = cli(['--no-install'], { cwd: dir });
  assert.equal(first.code, 0, first.stderr);

  const config = read(dir, 'astro.config.mjs');
  assert.match(config, /^import hydrogen from 'astro-hydrogen';$/m);
  assert.match(config, /output: 'server',/);
  assert.match(config, /adapter: hydrogen\(\),/);

  const pkg = JSON.parse(read(dir, 'package.json'));
  assert.equal(pkg.dependencies['astro-hydrogen'], '^0.1.0');
  assert.equal(pkg.dependencies['@shopify/hydrogen'], '^2026.10.1');
  assert.equal(pkg.dependencies.astro, '^7.4.0');
  assert.equal(pkg.devDependencies['@shopify/cli'], '^4.9.4');
  assert.equal(pkg.scripts.dev, 'astro dev');
  assert.match(pkg.scripts.deploy, /shopify hydrogen deploy --worker-dir dist\/server --assets-dir dist\/client/);

  assert.match(read(dir, 'src/pages/products/[handle].astro'), /PRODUCT_FORM_FRAGMENT/);
  assert.match(read(dir, 'src/pages/cart.astro'), /getCartId/);
  assert.match(read(dir, '.env.example'), /PUBLIC_STORE_DOMAIN/);
  assert.match(first.stdout, /npm run dev/);

  const before = snapshot(dir);
  const second = cli(['--no-install'], { cwd: dir });
  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(snapshot(dir), before);
  assert.match(second.stdout, /kept\s+src\/pages\/cart\.astro/);
});

test('init mode works when given the directory as an argument', (t) => {
  const dir = tempDir(t);
  astroProject(dir);
  write(dir, 'pnpm-lock.yaml', '');
  const result = cli([dir, '--no-install'], { cwd: tempDir(t) });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^ {2}pnpm dev$/m);
});

test('init mode never changes existing dependency entries', (t) => {
  const dir = tempDir(t);
  astroProject(dir);
  const pkg = JSON.parse(read(dir, 'package.json'));
  pkg.dependencies['astro-hydrogen'] = '^0.0.9';
  pkg.scripts.deploy = 'custom';
  write(dir, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  const result = cli(['--no-install'], { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  const after = JSON.parse(read(dir, 'package.json'));
  assert.equal(after.dependencies['astro-hydrogen'], '^0.0.9');
  assert.equal(after.scripts.deploy, 'custom');
  assert.match(result.stdout, /kept\s+astro-hydrogen@\^0\.0\.9/);
});

test('init mode leaves another adapter and a static output alone', (t) => {
  const dir = tempDir(t);
  const other = "import node from '@astrojs/node';\nimport { defineConfig } from 'astro/config';\n\nexport default defineConfig({\n  output: 'static',\n  adapter: node(),\n});\n";
  astroProject(dir, { config: other });
  const result = cli(['--no-install'], { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(read(dir, 'astro.config.mjs'), other);
  assert.match(result.stdout, /Another adapter is already configured/);
  assert.ok(listFiles(dir).includes('src/pages/cart.astro'));

  const dir2 = tempDir(t);
  astroProject(dir2, { config: "import { defineConfig } from 'astro/config';\n\nexport default defineConfig({\n  output: 'static',\n});\n" });
  const result2 = cli(['--no-install'], { cwd: dir2 });
  assert.equal(result2.code, 0, result2.stderr);
  const config = read(dir2, 'astro.config.mjs');
  assert.match(config, /output: 'static'/);
  assert.match(config, /adapter: hydrogen\(\)/);
  assert.match(result2.stdout, /prerender = false/);
});

test('init mode keeps an existing page', (t) => {
  const dir = tempDir(t);
  astroProject(dir);
  write(dir, 'src/pages/cart.astro', 'mine\n');
  const result = cli(['--no-install'], { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(read(dir, 'src/pages/cart.astro'), 'mine\n');
  assert.match(result.stdout, /kept\s+src\/pages\/cart\.astro/);
  assert.match(result.stdout, /created\s+src\/pages\/products\/\[handle\]\.astro/);
});

test('init mode edits export default { ... } configs', (t) => {
  const dir = tempDir(t);
  astroProject(dir, { config: "export default {\n  site: 'https://example.com',\n};\n" });
  const result = cli(['--no-install'], { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    read(dir, 'astro.config.mjs'),
    "import hydrogen from 'astro-hydrogen';\nexport default {\n  output: 'server',\n  adapter: hydrogen(),\n  site: 'https://example.com',\n};\n",
  );
});

test('init mode prints a manual snippet for an unrecognised config and still adds files', (t) => {
  const dir = tempDir(t);
  const odd = 'const config = build();\nexport default config;\n';
  astroProject(dir, { config: odd });
  const result = cli(['--no-install'], { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(read(dir, 'astro.config.mjs'), odd);
  assert.match(result.stdout, /import hydrogen from 'astro-hydrogen';/);
  assert.match(result.stdout, /output: 'server',/);
  assert.match(result.stdout, /adapter: hydrogen\(\),/);
  assert.ok(listFiles(dir).includes('src/pages/cart.astro'));
});

test('init mode finds and edits astro.config.ts', (t) => {
  const dir = tempDir(t);
  astroProject(dir, { configName: 'astro.config.ts', config: "import { defineConfig } from 'astro/config';\n\nexport default defineConfig({});\n" });
  const result = cli(['--no-install'], { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!listFiles(dir).includes('astro.config.mjs'));
  assert.match(read(dir, 'astro.config.ts'), /adapter: hydrogen\(\)/);
});

test('init mode creates astro.config.mjs when there is none', (t) => {
  const dir = tempDir(t);
  astroProject(dir, { config: null });
  const result = cli(['--no-install'], { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  assert.match(read(dir, 'astro.config.mjs'), /output: 'server'[\s\S]*adapter: hydrogen\(\)/);
});
