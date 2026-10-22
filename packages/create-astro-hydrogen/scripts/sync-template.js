// Regenerates template/ from examples/mock-shop, which stays the single source of truth.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = path.join(root, 'examples/mock-shop');
const target = path.join(root, 'packages/create-astro-hydrogen/template');
const adapter = JSON.parse(readFileSync(path.join(root, 'packages/astro-hydrogen/package.json'), 'utf8'));

const SKIP_ANYWHERE = new Set(['node_modules', 'dist', '.astro', '.DS_Store']);

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

cpSync(source, target, {
  recursive: true,
  filter(file) {
    const rel = path.relative(source, file);
    if (!rel) return true;
    const base = path.basename(file);
    if (SKIP_ANYWHERE.has(base)) return false;
    if (rel === 'README.md') return false;
    // Local secrets must never end up in a published template.
    if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return false;
    return true;
  },
});

// npm drops .gitignore from published packages, so it travels under another name.
writeFileSync(
  path.join(target, '_gitignore'),
  ['node_modules/', 'dist/', '.astro/', '.env', '.env.*', '!.env.example', '.shopify', '.DS_Store', '*.log', ''].join('\n'),
);

const pkgPath = path.join(target, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.name = '{{name}}';
pkg.dependencies['astro-hydrogen'] = `^${adapter.version}`;
// The example pins exact versions for reproducible CI; a new project should track patch and minor releases.
for (const name of ['astro', '@shopify/hydrogen']) {
  const version = pkg.dependencies[name];
  if (/^\d/.test(version)) pkg.dependencies[name] = `^${version}`;
}
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

writeFileSync(
  path.join(target, 'README.md'),
  `# {{name}}

An [Astro](https://astro.build) storefront for [Shopify Oxygen](https://shopify.dev/docs/storefronts/headless/hydrogen/deployment), built on the [astro-hydrogen](https://github.com/1cm-Agency/astro-hydrogen-oxygen-adaptor/tree/main/packages/astro-hydrogen#readme) adapter.

## Run it

\`\`\`sh
npm run dev
\`\`\`

Without any configuration it runs against the public [mock.shop](https://mock.shop) demo store.

## Use your own store

Link the project to your Shopify store, then pull its environment variables into \`.env\`:

\`\`\`sh
npx shopify hydrogen link
npx shopify hydrogen env pull
\`\`\`

\`.env.example\` lists the variables the adapter reads.

## Deploy to Oxygen

\`\`\`sh
npm run build
npm run deploy
\`\`\`

## Learn more

The adapter's options, components and runtime helpers are documented at https://github.com/1cm-Agency/astro-hydrogen-oxygen-adaptor/tree/main/packages/astro-hydrogen#readme
`,
);

console.log(`Synced template from examples/mock-shop (astro-hydrogen ^${adapter.version}).`);
