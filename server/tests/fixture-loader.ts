import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function loadFixture(name: string, extra: { path: string; content: string }[] = []) {
  const root = path.join(dir, name);
  const out: { path: string; content: string }[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const full = path.join(d, e);
      if (statSync(full).isDirectory()) walk(full);
      else
        out.push({
          path: path.relative(root, full).split(path.sep).join('/'),
          content: readFileSync(full, 'utf8'),
        });
    }
  };
  walk(root);
  return [...out, ...extra].sort((a, b) => a.path.localeCompare(b.path));
}

export const analysable = (files: { path: string; content: string }[]) =>
  files.filter((f) => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f.path));
