import path from 'node:path';
import { DEFAULT_CONFIG, MANUAL_SNIPPET, editAstroConfig } from './astro-config.js';
import { existsSync, readFileSync, writeFile } from './fs.js';
import { installCommand, runScript } from './package-manager.js';
import { runCommand } from './run-command.js';
import { INIT_FILES_DIR, TEMPLATE_DIR, readTemplatePackage } from './template.js';

const DEPLOY_SCRIPT = 'shopify hydrogen deploy --worker-dir dist/server --assets-dir dist/client';
const CONFIG_NAMES = ['mjs', 'js', 'ts', 'mts', 'cjs', 'cts'].map((ext) => `astro.config.${ext}`);

const PAGES = [
  ['products/[handle].astro', 'src/pages/products/[handle].astro'],
  ['cart.astro', 'src/pages/cart.astro'],
];

export function hasAstroDependency(pkg) {
  return Boolean(pkg?.dependencies?.astro || pkg?.devDependencies?.astro);
}

export function readPackageJson(dir) {
  const file = path.join(dir, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Appends keys, and keeps the block alphabetical only if it already was (as npm does).
function addEntries(pkg, field, entries) {
  const current = pkg[field] ?? {};
  const keys = Object.keys(current);
  const sorted = keys.every((key, i) => i === 0 || keys[i - 1] <= key);
  const next = { ...current, ...entries };
  pkg[field] = sorted ? Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1))) : next;
}

export function editPackageJson(text, wanted) {
  const pkg = JSON.parse(text);
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? '  ';
  const added = [];
  const kept = [];

  for (const [field, entries] of [
    ['dependencies', wanted.dependencies],
    ['devDependencies', wanted.devDependencies],
  ]) {
    const toAdd = {};
    for (const [name, range] of Object.entries(entries)) {
      const existing = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
      if (existing) kept.push(`${name}@${existing}`);
      else {
        toAdd[name] = range;
        added.push(`${name}@${range}`);
      }
    }
    if (Object.keys(toAdd).length > 0) addEntries(pkg, field, toAdd);
  }

  let scriptAdded = false;
  if (!pkg.scripts?.deploy) {
    pkg.scripts = { ...pkg.scripts, deploy: DEPLOY_SCRIPT };
    scriptAdded = true;
  }

  const changed = added.length > 0 || scriptAdded;
  return { text: changed ? `${JSON.stringify(pkg, null, indent)}\n` : text, added, kept, scriptAdded };
}

export function initProject({ dir, pm, install, log }) {
  const templatePkg = readTemplatePackage();
  const wanted = {
    dependencies: {
      'astro-hydrogen': templatePkg.dependencies['astro-hydrogen'],
      '@shopify/hydrogen': templatePkg.dependencies['@shopify/hydrogen'],
    },
    devDependencies: { '@shopify/cli': '^4.9.4' },
  };

  log(`Adding astro-hydrogen to ${dir}`);
  log('');

  // package.json
  const pkgFile = path.join(dir, 'package.json');
  const pkgResult = editPackageJson(readFileSync(pkgFile, 'utf8'), wanted);
  if (pkgResult.text !== readFileSync(pkgFile, 'utf8')) writeFile(pkgFile, pkgResult.text);
  for (const dep of pkgResult.added) log(`  added   ${dep}`);
  for (const dep of pkgResult.kept) log(`  kept    ${dep} (already in package.json, not changed)`);
  log(pkgResult.scriptAdded ? '  added   scripts.deploy' : '  kept    scripts.deploy');

  // Astro config
  const configName = CONFIG_NAMES.find((name) => existsSync(path.join(dir, name)));
  let manual = false;
  if (!configName) {
    writeFile(path.join(dir, 'astro.config.mjs'), DEFAULT_CONFIG);
    log('  created astro.config.mjs');
  } else {
    const file = path.join(dir, configName);
    const result = editAstroConfig(readFileSync(file, 'utf8'));
    if (result.status === 'edited') {
      writeFile(file, result.source);
      log(`  updated ${configName}`);
    } else if (result.status === 'configured') {
      log(`  kept    ${configName} (already uses astro-hydrogen)`);
    } else if (result.status === 'other-adapter') {
      log(`  kept    ${configName}`);
    } else {
      manual = true;
      log(`  kept    ${configName} (not recognised, see below)`);
    }
    if (manual) {
      log('');
      log(`Could not edit ${configName} safely. Add these to it by hand:`);
      for (const line of MANUAL_SNIPPET.split('\n')) log(`    ${line}`);
      log('');
    }
    for (const note of result.notes) {
      log('');
      log(`Note: ${note}`);
    }
  }

  // Pages and .env.example, never overwritten
  const files = [
    ...PAGES.map(([from, to]) => [path.join(INIT_FILES_DIR, from), to]),
    [path.join(TEMPLATE_DIR, '.env.example'), '.env.example'],
  ];
  for (const [from, to] of files) {
    const dest = path.join(dir, to);
    if (existsSync(dest)) log(`  kept    ${to}`);
    else {
      writeFile(dest, readFileSync(from, 'utf8'));
      log(`  created ${to}`);
    }
  }

  let installed = true;
  if (install) {
    log('');
    log(`Installing dependencies with ${pm}...`);
    const [command, args] = installCommand(pm);
    installed = runCommand(command, args, dir);
    if (!installed) log(`Dependency installation failed. Run \`${pm} install\` yourself once the problem is fixed.`);
  }

  log('');
  log('Next steps:');
  if (!install || !installed) log(`  ${pm} install`);
  log(`  ${runScript(pm, 'dev')}`);
  log('  Open /products/<handle> with a product handle from your store.');
  log('');
  log('It runs against the mock.shop demo store until you link yours:');
  log('  npx shopify hydrogen link && npx shopify hydrogen env pull');
  log('');
  log('Deploy to Oxygen:');
  log(`  ${runScript(pm, 'build')} && ${runScript(pm, 'deploy')}`);
  return installed;
}
