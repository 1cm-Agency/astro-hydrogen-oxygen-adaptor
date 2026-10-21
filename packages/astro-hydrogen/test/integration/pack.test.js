/**
 * Packs the adapter as `npm publish` would, extracts the tarball, and builds a project that
 * imports `astro-hydrogen` from the extracted copy, so a file missing from `files` fails here
 * instead of after publishing.
 *
 * The project lives outside the monorepo, so `astro dev` could not read the symlinked adapter
 * (Vite's `server.fs.allow`); only `build` and MiniOxygen run against it.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { buildFixture, pathOf } from '../helpers/fixture.js';
import { textById } from '../helpers/html.js';

const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));
const ROOT_MODULES = fileURLToPath(new URL('../../../../node_modules/', import.meta.url));

describe('npm pack', () => {
  let tmp;
  let packed;
  let site;
  let files;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'astro-hydrogen-pack-'));
    const tarballs = join(tmp, 'tarballs');
    mkdirSync(tarballs);
    const [{ filename }] = JSON.parse(
      execFileSync('npm', ['pack', '--json', '--pack-destination', tarballs], { cwd: PACKAGE_DIR, encoding: 'utf8' }),
    );
    const extract = join(tmp, 'extract');
    mkdirSync(extract);
    execFileSync('tar', ['-xzf', join(tarballs, filename), '-C', extract]);
    packed = join(extract, 'package');
    files = execFileSync('tar', ['-tzf', join(tarballs, filename)], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line && !line.endsWith('/'))
      .map((line) => line.replace(/^package\//, ''));

    // The adapter's own dependencies (@shopify/mini-oxygen, rolldown, ...) resolve from the root install.
    symlinkSync(ROOT_MODULES, join(extract, 'node_modules'), 'dir');

    // A project outside the monorepo whose node_modules is the root install, minus the workspace
    // link to the adapter, plus a link to the extracted copy.
    const project = join(tmp, 'project');
    cpSync(pathOf('minimal'), project, {
      recursive: true,
      filter: (source) => !/\/(dist|node_modules|\.astro)(\/|$)/.test(source),
    });
    const modules = join(project, 'node_modules');
    mkdirSync(modules);
    for (const entry of readdirSync(ROOT_MODULES)) {
      if (entry.startsWith('.') || entry === 'astro-hydrogen') continue;
      symlinkSync(join(ROOT_MODULES, entry), join(modules, entry));
    }
    symlinkSync(packed, join(modules, 'astro-hydrogen'), 'dir');

    site = await buildFixture(project);
  });

  after(async () => {
    await site?.dispose();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('contains the built output, components, types and docs, and nothing else', () => {
    for (const required of ['package.json', 'README.md', 'types.d.ts', 'dist/index.js', 'dist/entrypoints/server.js', 'components/ShopifyScripts.astro']) {
      assert.ok(files.includes(required), `${required} is in the tarball`);
    }
    const unexpected = files.filter(
      (file) => !/^(dist|components)\//.test(file) && !['package.json', 'README.md', 'types.d.ts', 'LICENSE', 'CHANGELOG.md'].includes(file),
    );
    assert.deepEqual(unexpected, []);
    assert.ok(!files.some((file) => /\.test\.|^(src|test)\//.test(file)), 'no sources or tests');
  });

  it('ships every file the package exports map points at', () => {
    const { exports } = JSON.parse(readFileSync(join(packed, 'package.json'), 'utf8'));
    const targets = [];
    const visit = (value) => (typeof value === 'string' ? targets.push(value) : Object.values(value).forEach(visit));
    visit(exports);
    for (const target of targets) {
      const path = target.replace(/^\.\//, '');
      if (path.includes('*')) {
        assert.ok(files.some((file) => file.startsWith(path.slice(0, path.indexOf('*')))), `${target} matches a packed file`);
      } else {
        assert.ok(files.includes(path), `${target} is packed`);
      }
    }
  });

  it('builds a project that imports the extracted package and runs it in the Worker', async () => {
    assert.ok(realpathSync(join(site.root, 'node_modules/astro-hydrogen')).startsWith(realpathSync(tmp)), 'uses the packed copy');
    assert.ok(existsSync(join(site.dist, 'server/index.js')));
    const res = await site.fetch('/');
    assert.equal(res.status, 200);
    assert.equal(textById(await res.text(), 'type'), 'public');
    assert.deepEqual(await (await site.fetch('/api/cart')).json(), { cart: null });
  });
});
