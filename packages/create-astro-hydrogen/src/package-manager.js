import { existsSync } from 'node:fs';
import path from 'node:path';

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];

const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

// `npm create`, `pnpm create`, `yarn create` and `bun create` all set npm_config_user_agent.
export function packageManagerFromUserAgent(userAgent) {
  const name = /^(npm|pnpm|yarn|bun)\//.exec(userAgent ?? '')?.[1];
  return name ?? null;
}

export function packageManagerFromLockfile(dir) {
  if (!dir) return null;
  for (const [file, pm] of LOCKFILES) {
    if (existsSync(path.join(dir, file))) return pm;
  }
  return null;
}

export function detectPackageManager({ flag, userAgent, dir } = {}) {
  return flag ?? packageManagerFromUserAgent(userAgent) ?? packageManagerFromLockfile(dir) ?? 'npm';
}

export function installCommand(pm) {
  return [pm, ['install']];
}

// npm and bun need `run`; pnpm and yarn run package scripts directly.
export function runScript(pm, script) {
  return pm === 'npm' || pm === 'bun' ? `${pm} run ${script}` : `${pm} ${script}`;
}
