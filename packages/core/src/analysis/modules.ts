import * as posix from '../util/posixPath';
import type { EdgeRow } from './types';

/**
 * Module detection for the architecture map (P3.1). Pure and deterministic.
 *  - Monorepos: every nested package.json is a package module (named from its "name" field); files belong to the
 *    deepest package that contains them. A root "workspaces" field marks the repository as a monorepo.
 *  - Elsewhere: files are grouped by directory: the first folder under src/ (or under the package root), or the
 *    top-level folder outside src/. Files directly in the root (or src/) form the "top level" module.
 *  - Dependencies: resolved import edges between files of different modules, counted.
 */
export interface ModuleInfo {
  key: string;
  name: string;
  kind: 'package' | 'directory';
  /** Directory the module covers ('' for the repository root). */
  root: string;
  files: string[];
}

export interface ModuleDependency {
  from: string;
  to: string;
  imports: number;
}

export interface ArchitectureMap {
  monorepo: boolean;
  modules: ModuleInfo[];
  dependencies: ModuleDependency[];
}

function packageName(content: string, fallback: string): string {
  try {
    const name = (JSON.parse(content) as { name?: unknown }).name;
    return typeof name === 'string' && name.trim() ? name.trim() : fallback;
  } catch {
    return fallback;
  }
}

function hasWorkspaces(content: string | undefined): boolean {
  if (!content) return false;
  try {
    const w = (JSON.parse(content) as { workspaces?: unknown }).workspaces;
    return (
      Array.isArray(w) ||
      (typeof w === 'object' && w !== null && Array.isArray((w as { packages?: unknown }).packages))
    );
  } catch {
    return false;
  }
}

/** Directory module of a path relative to `base` (a package root or ''). */
function dirModule(path: string, base: string): { root: string; name: string } {
  const rel = base ? path.slice(base.length + 1) : path;
  const parts = rel.split('/');
  const prefix = base ? `${base}/` : '';
  if (parts.length === 1)
    return { root: base, name: base ? posix.normalize(base).split('/').pop()! : 'top level' };
  if (parts[0] === 'src') {
    if (parts.length === 2)
      return { root: `${prefix}src`, name: base ? `${base.split('/').pop()}/src` : 'src (top level)' };
    return { root: `${prefix}src/${parts[1]}`, name: parts[1]! };
  }
  return { root: `${prefix}${parts[0]}`, name: parts[0]! };
}

export function detectModules(
  paths: string[],
  packageJsons: { path: string; content: string }[],
  edges: EdgeRow[],
): ArchitectureMap {
  const root = packageJsons.find((p) => p.path === 'package.json');
  const packages = packageJsons
    .filter((p) => p.path !== 'package.json')
    .map((p) => {
      const dir = posix.dirname(p.path);
      return { dir, name: packageName(p.content, dir) };
    })
    .sort((a, b) => b.dir.length - a.dir.length || (a.dir < b.dir ? -1 : 1)); // deepest first
  const monorepo = packages.length > 0 || hasWorkspaces(root?.content);

  const modules = new Map<string, ModuleInfo>();
  const moduleOf = new Map<string, string>();
  for (const path of [...paths].sort()) {
    const pkg = packages.find((p) => path.startsWith(`${p.dir}/`));
    const m = pkg
      ? { key: `pkg:${pkg.dir}`, name: pkg.name, kind: 'package' as const, root: pkg.dir }
      : (() => {
          const d = dirModule(path, '');
          return { key: `dir:${d.root}`, name: d.name, kind: 'directory' as const, root: d.root };
        })();
    const existing = modules.get(m.key);
    if (existing) existing.files.push(path);
    else modules.set(m.key, { ...m, files: [path] });
    moduleOf.set(path, m.key);
  }

  const counts = new Map<string, number>();
  for (const e of edges) {
    if (e.type !== 'imports' || !e.targetPath || e.reason) continue;
    const from = moduleOf.get(e.sourcePath);
    const to = moduleOf.get(e.targetPath);
    if (!from || !to || from === to) continue;
    const k = `${from}\u0000${to}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const dependencies = [...counts.entries()]
    .map(([k, imports]) => {
      const [from, to] = k.split('\u0000') as [string, string];
      return { from, to, imports };
    })
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  return {
    monorepo,
    modules: [...modules.values()].sort((a, b) => (a.key < b.key ? -1 : 1)),
    dependencies,
  };
}
