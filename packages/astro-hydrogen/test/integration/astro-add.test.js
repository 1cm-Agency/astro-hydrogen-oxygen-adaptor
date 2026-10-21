/**
 * `astro add astro-hydrogen` reads the package's keywords and, because `astro-integration` is
 * present, writes `integrations: [hydrogen()]` (no `adapter`). This covers that config shape end to
 * end: the integration alone must register the adapter and the on-demand output.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { buildFixture } from '../helpers/fixture.js';
import { textById } from '../helpers/html.js';

describe('integrations-only config (what `astro add` writes)', () => {
  let site;
  before(async () => {
    site = await buildFixture('integrations-only');
  });
  after(() => site?.dispose());

  it('builds the Oxygen worker with the adapter active', () => {
    assert.ok(existsSync(`${site.dist}/server/index.js`));
    assert.ok(existsSync(`${site.dist}/server/oxygen.json`));
    assert.ok(existsSync(`${site.dist}/client/static/index.html`), 'static page is prerendered');
  });

  it('serves the on-demand page with a public Storefront client', async () => {
    const res = await site.fetch('/');
    assert.equal(res.status, 200);
    assert.equal(textById(await res.text(), 'type'), 'public');
  });

  it('serves /api/cart', async () => {
    const res = await site.fetch('/api/cart');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { cart: null });
  });
});

describe('package keywords for `astro add`', () => {
  const require = createRequire(import.meta.url);
  const { keywords } = require('../../package.json');

  it('declares both astro-adapter and astro-integration', () => {
    assert.ok(keywords.includes('astro-adapter'));
    assert.ok(keywords.includes('astro-integration'));
  });

  it('is classified as an integration before an adapter by the installed Astro', (t) => {
    const source = readFileSync(join(dirname(require.resolve('astro/package.json')), 'dist/cli/add/index.js'), 'utf8');
    const integration = source.indexOf('keywords.includes("astro-integration")');
    const adapter = source.indexOf('keywords.includes("astro-adapter")');
    if (integration === -1 || adapter === -1) {
      t.skip('astro add source changed shape; re-verify keyword precedence by hand');
      return;
    }
    assert.ok(integration < adapter, 'astro-integration is checked first');
  });
});
