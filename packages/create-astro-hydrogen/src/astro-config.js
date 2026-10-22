// Textual edits only: a parser would be a dependency, and configs are small and regular.
const IMPORT_LINE = "import hydrogen from 'astro-hydrogen';";

export const DEFAULT_CONFIG = `import { defineConfig } from 'astro/config';
${IMPORT_LINE}

export default defineConfig({
  output: 'server',
  adapter: hydrogen(),
});
`;

export const MANUAL_SNIPPET = `${IMPORT_LINE}
// then, in your Astro config:
output: 'server',
adapter: hydrogen(),`;

const KEY = (name) => new RegExp(`(^|[\\s,{])${name}\\s*:`);
const IMPORT_STATEMENT = /^import\s+(?:[^'"]*?\s+from\s+)?['"][^'"\n]+['"][ \t]*;?[ \t]*$/gm;
const CONFIG_OPEN = /(?:defineConfig\(\s*\{|export\s+default\s*\{)/;

// Returns { source, status, notes }. status is one of:
// 'edited', 'configured' (already set up), 'other-adapter', 'manual' (shape not recognised).
export function editAstroConfig(source) {
  const existingImport = /import\s+(\w+)\s+from\s+['"]astro-hydrogen['"]/.exec(source);
  const local = existingImport?.[1] ?? 'hydrogen';

  if (KEY('adapter').test(source)) {
    if (existingImport || /adapter\s*:\s*hydrogen\s*\(/.test(source)) {
      return { source, status: 'configured', notes: [] };
    }
    return {
      source,
      status: 'other-adapter',
      notes: [
        'Another adapter is already configured, so the Astro config was left alone.',
        "To switch to Oxygen, replace it with `adapter: hydrogen()` and add `import hydrogen from 'astro-hydrogen';`.",
      ],
    };
  }

  const open = CONFIG_OPEN.exec(source);
  if (!open) return { source, status: 'manual', notes: [] };

  const notes = [];
  const output = /(?:^|[\s,{])output\s*:\s*(['"`]?)([\w-]+)\1/.exec(source);
  const hasOutput = KEY('output').test(source);
  if (hasOutput && !(output && output[2] === 'server')) {
    notes.push(
      "`output` is not 'server', so pages are prerendered by default. Add `export const prerender = false` to a page to render it on demand.",
    );
  }

  // Indentation: follow the first property if there is one, else the line's own indent plus two.
  const braceEnd = open.index + open[0].length;
  const lineStart = source.lastIndexOf('\n', open.index) + 1;
  const baseIndent = /^[ \t]*/.exec(source.slice(lineStart))[0];
  const rest = source.slice(braceEnd);
  const restOfLine = rest.slice(0, rest.indexOf('\n') === -1 ? rest.length : rest.indexOf('\n'));
  let indent = `${baseIndent}  `;
  if (restOfLine.trim() === '') {
    const next = /\n([ \t]*)\S/.exec(rest);
    if (next && next[1].length > baseIndent.length) indent = next[1];
  }

  const props = [...(hasOutput ? [] : ["output: 'server',"]), `adapter: ${local}(),`];
  let insertion = props.map((p) => `\n${indent}${p}`).join('');
  let tail = rest;
  if (restOfLine.trim() !== '') {
    const trimmed = rest.replace(/^[ \t]+/, '');
    insertion += trimmed.startsWith('}') ? `\n${baseIndent}` : `\n${indent}`;
    tail = trimmed;
  }

  let edited = source.slice(0, braceEnd) + insertion + tail;

  if (!existingImport) {
    const matches = [...edited.matchAll(IMPORT_STATEMENT)];
    const last = matches.at(-1);
    edited = last
      ? `${edited.slice(0, last.index + last[0].length)}\n${IMPORT_LINE}${edited.slice(last.index + last[0].length)}`
      : `${IMPORT_LINE}\n${edited}`;
  }

  return { source: edited, status: 'edited', notes };
}
