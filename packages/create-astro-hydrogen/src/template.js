import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from './fs.js';

export const TEMPLATE_DIR = fileURLToPath(new URL('../template/', import.meta.url));
export const INIT_FILES_DIR = fileURLToPath(new URL('./init-files/', import.meta.url));

// The generated template is the one place the pinned versions live.
export function readTemplatePackage() {
  return JSON.parse(readFileSync(path.join(TEMPLATE_DIR, 'package.json'), 'utf8'));
}
