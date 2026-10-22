import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editAstroConfig } from '../src/astro-config.js';

test('inserts import, output and adapter into defineConfig({', () => {
  const src = `import { defineConfig } from 'astro/config';\nimport mdx from '@astrojs/mdx';\n\nexport default defineConfig({\n  integrations: [mdx()],\n});\n`;
  const result = editAstroConfig(src);
  assert.equal(result.status, 'edited');
  assert.equal(
    result.source,
    `import { defineConfig } from 'astro/config';\nimport mdx from '@astrojs/mdx';\nimport hydrogen from 'astro-hydrogen';\n\nexport default defineConfig({\n  output: 'server',\n  adapter: hydrogen(),\n  integrations: [mdx()],\n});\n`,
  );
});

test('handles a one-line defineConfig and keeps the file valid', () => {
  const src = `import { defineConfig } from 'astro/config';\n\nexport default defineConfig({ integrations: [] });\n`;
  const { source } = editAstroConfig(src);
  assert.match(source, /defineConfig\(\{\n  output: 'server',\n  adapter: hydrogen\(\),\n  integrations: \[\] \}\);/);
});

test('handles an empty defineConfig({})', () => {
  const { source } = editAstroConfig(`import { defineConfig } from 'astro/config';\nexport default defineConfig({});\n`);
  assert.match(source, /defineConfig\(\{\n  output: 'server',\n  adapter: hydrogen\(\),\n\}\);/);
});

test('handles multi-line imports and 4-space indentation', () => {
  const src = `import {\n  defineConfig,\n} from 'astro/config';\n\nexport default defineConfig({\n    site: 'https://x.dev',\n});\n`;
  const { source } = editAstroConfig(src);
  assert.match(source, /\} from 'astro\/config';\nimport hydrogen from 'astro-hydrogen';\n/);
  assert.match(source, /\n    output: 'server',\n    adapter: hydrogen\(\),\n    site:/);
});

test('handles export default { ... } and a file without imports', () => {
  const { source, status } = editAstroConfig(`export default {\n  site: 'https://x.dev',\n};\n`);
  assert.equal(status, 'edited');
  assert.equal(
    source,
    `import hydrogen from 'astro-hydrogen';\nexport default {\n  output: 'server',\n  adapter: hydrogen(),\n  site: 'https://x.dev',\n};\n`,
  );
});

test('only inserts adapter when output is already server', () => {
  const { source } = editAstroConfig(`import { defineConfig } from 'astro/config';\nexport default defineConfig({\n  output: 'server',\n});\n`);
  assert.equal(source.match(/output:/g).length, 1);
  assert.match(source, /adapter: hydrogen\(\)/);
});

test('is idempotent', () => {
  const first = editAstroConfig(`import { defineConfig } from 'astro/config';\nexport default defineConfig({});\n`);
  const second = editAstroConfig(first.source);
  assert.equal(second.status, 'configured');
  assert.equal(second.source, first.source);
});

test('leaves another adapter alone', () => {
  const src = `import node from '@astrojs/node';\nexport default defineConfig({\n  adapter: node(),\n});\n`;
  const result = editAstroConfig(src);
  assert.equal(result.status, 'other-adapter');
  assert.equal(result.source, src);
  assert.match(result.notes.join('\n'), /another adapter|Another adapter/);
});

test('leaves a non-server output alone and notes prerendering', () => {
  const result = editAstroConfig(`export default defineConfig({\n  output: 'static',\n});\n`);
  assert.equal(result.status, 'edited');
  assert.match(result.source, /output: 'static'/);
  assert.equal(result.source.match(/output:/g).length, 1);
  assert.match(result.source, /adapter: hydrogen\(\)/);
  assert.match(result.notes.join('\n'), /prerender = false/);
});

test('reports an unrecognised shape without editing', () => {
  const src = `const config = makeConfig();\nexport default config;\n`;
  const result = editAstroConfig(src);
  assert.equal(result.status, 'manual');
  assert.equal(result.source, src);
});
