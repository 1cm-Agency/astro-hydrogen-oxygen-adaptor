import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export { existsSync, readFileSync };

export function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Entries a fresh checkout or the OS may leave behind do not make a directory "non-empty".
const IGNORED = new Set(['.git', '.DS_Store']);

export function isEmptyDirectory(p) {
  return readdirSync(p).every((name) => IGNORED.has(name));
}

export function writeFile(file, contents) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

// Copies a tree, renaming and rewriting text files on the way.
export function copyTemplate(from, to, { rename = {}, replace = {} } = {}) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, rename[entry.name] ?? entry.name);
    if (entry.isDirectory()) {
      copyTemplate(src, dest, { rename, replace });
      continue;
    }
    const buffer = readFileSync(src);
    if (buffer.includes(0)) {
      cpSync(src, dest);
      continue;
    }
    let text = buffer.toString('utf8');
    for (const [token, value] of Object.entries(replace)) text = text.split(token).join(value);
    writeFileSync(dest, text);
  }
}

export function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
    })
    .sort();
}
