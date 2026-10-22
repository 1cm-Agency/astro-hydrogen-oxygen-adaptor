import path from 'node:path';
import { copyTemplate, existsSync } from './fs.js';
import { installCommand, runScript } from './package-manager.js';
import { isInsideGitWorkTree, runCommand } from './run-command.js';
import { TEMPLATE_DIR } from './template.js';

export function toPackageName(dirName) {
  const name = dirName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|-+$/g, '');
  return name || 'astro-hydrogen-app';
}

export function createProject({ dir, pm, install, git, log, cwd }) {
  if (!existsSync(TEMPLATE_DIR)) {
    throw new Error('The project template is missing. Run `npm run sync-template` in packages/create-astro-hydrogen.');
  }
  const name = toPackageName(path.basename(dir));
  copyTemplate(TEMPLATE_DIR, dir, {
    rename: { _gitignore: '.gitignore' },
    replace: { '{{name}}': name },
  });
  log(`Created ${name} from the mock-shop template.`);

  if (git) {
    if (isInsideGitWorkTree(dir)) log('Skipped git init: already inside a git repository.');
    else if (runCommand('git', ['init'], dir, { quiet: true })) log('Initialised a git repository.');
    else log('Could not run git init; skipping.');
  }

  let installed = true;
  if (install) {
    log(`Installing dependencies with ${pm}...`);
    const [command, args] = installCommand(pm);
    installed = runCommand(command, args, dir);
    if (!installed) log(`Dependency installation failed. Run \`${pm} install\` yourself once the problem is fixed.`);
  }

  const rel = path.relative(cwd, dir);
  log('');
  log('Next steps:');
  if (rel) log(`  cd ${rel.includes(' ') ? JSON.stringify(rel) : rel}`);
  if (!install || !installed) log(`  ${pm} install`);
  log(`  ${runScript(pm, 'dev')}`);
  log('');
  log('It runs against the mock.shop demo store. To use your own store:');
  log('  npx shopify hydrogen link && npx shopify hydrogen env pull');
  log('');
  log('Deploy to Oxygen:');
  log(`  ${runScript(pm, 'build')} && ${runScript(pm, 'deploy')}`);
  return installed;
}
