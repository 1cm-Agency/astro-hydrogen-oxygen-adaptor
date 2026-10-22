import path from 'node:path';
import { parseArgs } from 'node:util';
import { initProject, hasAstroDependency, readPackageJson } from './init-project.js';
import { isDirectory, isEmptyDirectory, existsSync } from './fs.js';
import { createProject } from './new-project.js';
import { PACKAGE_MANAGERS, detectPackageManager } from './package-manager.js';

export const USAGE = `Usage: create-astro-hydrogen [dir] [options]

Creates an Astro storefront for Shopify Oxygen in <dir>, or, when <dir> is an
existing Astro project (default: the current directory), adds the astro-hydrogen
adapter to it. Existing files are never overwritten.

Options:
  --no-install       Skip installing dependencies
  --no-git           Skip \`git init\` (new projects only)
  --pm <name>        Package manager: ${PACKAGE_MANAGERS.join(', ')} (default: detected)
  --help             Show this message
`;

// Decides between new and init mode; { error } explains a refusal.
export function resolveMode(target) {
  if (!existsSync(target)) return { mode: 'new' };
  if (!isDirectory(target)) return { error: `${target} exists and is not a directory.` };
  if (isEmptyDirectory(target)) return { mode: 'new' };
  if (hasAstroDependency(readPackageJson(target))) return { mode: 'init' };
  return {
    error: `${target} is not empty and is not an Astro project (no "astro" in its package.json). Choose an empty or new directory.`,
  };
}

export async function run(argv, { cwd = process.cwd(), env = process.env, log = console.log } = {}) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        install: { type: 'boolean', default: true },
        git: { type: 'boolean', default: true },
        pm: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowNegative: true,
    });
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    return 1;
  }
  const { values, positionals } = parsed;

  if (values.help) {
    log(USAGE);
    return 0;
  }
  if (positionals.length > 1) {
    console.error(`Expected at most one directory, got ${positionals.length}.\n\n${USAGE}`);
    return 1;
  }
  if (values.pm && !PACKAGE_MANAGERS.includes(values.pm)) {
    console.error(`Unknown package manager "${values.pm}". Use one of: ${PACKAGE_MANAGERS.join(', ')}.`);
    return 1;
  }

  let target;
  if (positionals[0]) target = path.resolve(cwd, positionals[0]);
  else if (hasAstroDependency(readPackageJson(cwd))) target = cwd;
  else {
    console.error(USAGE);
    return 1;
  }

  const decision = resolveMode(target);
  if (decision.error) {
    console.error(decision.error);
    return 1;
  }

  const pm = detectPackageManager({
    flag: values.pm,
    userAgent: env.npm_config_user_agent,
    dir: decision.mode === 'init' ? target : undefined,
  });

  try {
    const ok =
      decision.mode === 'init'
        ? initProject({ dir: target, pm, install: values.install, log })
        : createProject({ dir: target, pm, install: values.install, git: values.git, log, cwd });
    return ok ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}
