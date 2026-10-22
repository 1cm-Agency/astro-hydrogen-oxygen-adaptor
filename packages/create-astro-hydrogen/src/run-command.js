import { spawnSync } from 'node:child_process';

// Resolves to true when the command exits 0. shell is needed for .cmd shims on Windows.
export function runCommand(command, args, cwd, { quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: quiet ? 'ignore' : 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

export function isInsideGitWorkTree(cwd) {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim() === 'true';
}
