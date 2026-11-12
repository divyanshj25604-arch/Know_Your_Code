import type {
  AnnotationTargetKind,
  ArchitectureView,
  FileGraphView,
  FileOutlineView,
  FlowDetail,
  FlowStepView,
  Relations,
} from '@kyc/contracts';
import type { GraphEdge, GraphNode, Prov } from '../graph/GraphCanvas';

/**
 * Builders that turn stored analysis into the graphs Explore shows. Every node and edge comes from the API data passed
 * in; nothing is invented. Where the analysis could not follow something, it appears as a "Not sure" node with the
 * reason, never as a guessed connection.
 */

/** What a graph node or edge stands for: how it opens in the code, and what a note on it is attached to. */
export type Target =
  | { kind: 'module'; key: string; name: string; root: string }
  | { kind: 'file'; path: string }
  | {
      kind: 'symbol';
      id: string | null;
      key: string | null;
      name: string;
      path: string;
      line: number;
      endLine?: number;
    }
  | { kind: 'package'; name: string; database: boolean }
  | { kind: 'step'; flowKey: string; index: number; step: FlowStepView }
  | { kind: 'unknown'; label: string; path: string | null; line: number | null; reason: string }
  | {
      kind: 'relation';
      label: string;
      from: string;
      to: string;
      path: string;
      line: number;
      provenance: Prov;
      noteKey: string;
    };

export interface Built {
  nodes: GraphNode[];
  edges: GraphEdge[];
  targets: Map<string, Target>;
  /** Something was left out to keep the graph readable (for example "12 more files"). */
  omitted?: string;
  fixedRank?: Map<string, number>;
}

/** Packages whose calls are, by name, database or data-store access. The classification is a pattern: Likely. */
export const DATABASE_PACKAGES = new Set([
  'mongoose',
  'mongodb',
  'pg',
  'pg-promise',
  'postgres',
  'mysql',
  'mysql2',
  'sqlite3',
  'better-sqlite3',
  '@prisma/client',
  'prisma',
  'sequelize',
  'typeorm',
  'knex',
  'drizzle-orm',
  'redis',
  'ioredis',
  '@supabase/supabase-js',
  'firebase-admin',
  'dynamoose',
  '@aws-sdk/client-dynamodb',
  '@aws-sdk/lib-dynamodb',
  'mikro-orm',
  '@mikro-orm/core',
  'objection',
  'lowdb',
  'nedb',
]);

export const nodeId = {
  module: (key: string) => `m:${key}`,
  file: (path: string) => `f:${path}`,
  symbol: (id: string) => `s:${id}`,
  package: (name: string) => `p:${name}`,
  step: (i: number) => `step:${i}`,
};

export const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The note target of a graph entity (stable across re-analysis), or null when it cannot carry a note. */
export function noteTarget(t: Target): {
  kind: AnnotationTargetKind;
  key: string;
  label: string;
  path: string | null;
  line: number | null;
} | null {
  switch (t.kind) {
    case 'module':
      return { kind: 'module', key: t.key, label: `Module ${t.name}`, path: null, line: null };
    case 'file':
      return { kind: 'file', key: t.path, label: t.path, path: t.path, line: null };
    case 'symbol':
      return {
        kind: 'symbol',
        key: t.key ?? `${t.path}#${t.name}`,
        label: `${t.name} (${base(t.path)})`,
        path: t.path,
        line: t.line,
      };
    case 'step':
      return {
        kind: 'flow_step',
        key: `${t.flowKey}#${t.index}`,
        label: `${t.flowKey}, step ${t.index + 1}: ${t.step.label}`,
        path: t.step.path,
        line: t.step.line,
      };
    case 'relation':
      return { kind: 'relation', key: t.noteKey, label: t.label, path: t.path, line: t.line };
    default:
      return null;
  }
}

/** The single code location a target opens at (null for modules and packages). */
export function targetLocation(t: Target): { path: string; line: number } | null {
  switch (t.kind) {
    case 'file':
      return { path: t.path, line: 1 };
    case 'symbol':
      return { path: t.path, line: t.line };
    case 'step':
      return t.step.path && t.step.line ? { path: t.step.path, line: t.step.line } : null;
    case 'unknown':
      return t.path && t.line ? { path: t.path, line: t.line } : null;
    case 'relation':
      return { path: t.path, line: t.line };
    default:
      return null;
  }
}

type FileEdge = FileGraphView['edges'][number];
const KIND_WORD = (e: FileEdge) => (e.kind === 'references' ? (e.jsx ? 'renders' : 'uses') : e.kind);

/** One label for all relationships between the same two nodes: "imports, calls ×3". */
function combine(list: FileEdge[]): { label: string; provenance: Prov; line: number; first: FileEdge } {
  const byWord = new Map<string, number>();
  for (const e of list) byWord.set(KIND_WORD(e), (byWord.get(KIND_WORD(e)) ?? 0) + e.count);
  const order = ['imports', 'calls', 'renders', 'uses'];
  const label = [...byWord]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([w, n]) => (n > 1 ? `${w} ×${n}` : w))
    .join(', ');
  const first = [...list].sort((a, b) => order.indexOf(KIND_WORD(a)) - order.indexOf(KIND_WORD(b)))[0]!;
  return {
    label,
    provenance: list.every((e) => e.provenance === 'verified') ? 'verified' : 'pattern',
    line: first.line,
    first,
  };
}

function relationTarget(from: string, to: string, list: FileEdge[], label: string): Target {
  const c = combine(list);
  return {
    kind: 'relation',
    label: `${base(from)} → ${base(to)}: ${label}`,
    from,
    to,
    path: from,
    line: c.line,
    provenance: c.provenance,
    noteKey: `${from}|${c.first.kind}|${to}`,
  };
}

function packageNode(name: string, count: number): GraphNode {
  const db = DATABASE_PACKAGES.has(name);
  return {
    id: nodeId.package(name),
    label: name,
    sub: db ? 'database client · package' : 'package',
    kind: db ? 'database' : 'package',
    ...(db
      ? {
          provenance: 'pattern' as Prov,
          hint: `Likely data access: the code calls into ${name} ${plural(count, 'time')}. The call is verified; that it reaches a database is inferred from the package name.`,
        }
      : { hint: `An npm package your code calls ${plural(count, 'time')}.` }),
  };
}

/** The packages a set of files calls into: database clients first, then the most used, at most `limit`. */
function topPackages(fg: FileGraphView, files: Set<string>, limit: number) {
  const calls = new Map<string, number>();
  for (const x of fg.externals) {
    if (x.kind !== 'calls' || !files.has(x.from)) continue;
    calls.set(x.package, (calls.get(x.package) ?? 0) + x.count);
  }
  return [...calls]
    .sort(
      (a, b) =>
        Number(DATABASE_PACKAGES.has(b[0])) - Number(DATABASE_PACKAGES.has(a[0])) ||
        b[1] - a[1] ||
        a[0].localeCompare(b[0]),
    )
    .slice(0, limit);
}

// ---------------------------------------------------------------- architecture: application level

export function buildApplication(
  arch: ArchitectureView,
  fg: FileGraphView | null,
  notes: (key: string) => number,
): Built {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const targets = new Map<string, Target>();
  const analysable = new Set((fg?.files ?? []).filter((f) => f.analysable).map((f) => f.path));
  for (const m of arch.modules) {
    const id = nodeId.module(m.key);
    const n = notes(m.key);
    nodes.push({
      id,
      label: m.name,
      sub: `${plural(m.files.length, 'file')} · ${m.root || '/'}`,
      kind: 'module',
      canDrill: true,
      hint: `${m.kind === 'package' ? 'Workspace package' : 'Folder'} ${m.root || '/'}. Open it to see its files and how they connect.`,
      ...(n ? { badge: `✎ ${n}` } : {}),
    });
    targets.set(id, { kind: 'module', key: m.key, name: m.name, root: m.root });
  }
  for (const d of arch.dependencies) {
    const label = `imports ×${d.imports}`;
    edges.push({
      id: `md:${d.from}>${d.to}`,
      from: nodeId.module(d.from),
      to: nodeId.module(d.to),
      label,
      provenance: 'verified',
      hint: `${plural(d.imports, 'import')} from files in one module to files in the other, verified by the parser.`,
    });
  }
  if (fg) {
    // Packages the modules call into, database clients first: where data leaves the application.
    const moduleOf = new Map(fg.files.map((f) => [f.path, f.module]));
    for (const [pkg, count] of topPackages(fg, analysable, 5)) {
      const pid = nodeId.package(pkg);
      nodes.push(packageNode(pkg, count));
      targets.set(pid, { kind: 'package', name: pkg, database: DATABASE_PACKAGES.has(pkg) });
      const perModule = new Map<string, number>();
      for (const x of fg.externals) {
        if (x.kind !== 'calls' || x.package !== pkg) continue;
        const m = moduleOf.get(x.from);
        if (m) perModule.set(m, (perModule.get(m) ?? 0) + x.count);
      }
      for (const [m, n] of perModule)
        edges.push({
          id: `mp:${m}>${pkg}`,
          from: nodeId.module(m),
          to: pid,
          label: n > 1 ? `calls ×${n}` : 'calls',
          provenance: 'verified',
        });
    }
  }
  return { nodes, edges, targets };
}

// ---------------------------------------------------------------- architecture: module level (its files)

const MAX_FILES = 36;

export function buildModule(
  arch: ArchitectureView,
  fg: FileGraphView,
  moduleKey: string,
  notes: (key: string) => number,
  kinds: Set<string>,
): Built {
  const mod = arch.modules.find((m) => m.key === moduleKey);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const targets = new Map<string, Target>();
  if (!mod) return { nodes, edges, targets };
  const info = new Map(fg.files.map((f) => [f.path, f]));
  const moduleOf = (p: string) => info.get(p)?.module ?? null;
  const inMod = mod.files.filter((p) => info.get(p)?.analysable);
  const shown = (fe: FileEdge) => kinds.has(KIND_WORD(fe) === 'renders' ? 'uses' : KIND_WORD(fe));
  const fes = fg.edges.filter(shown);
  const degree = new Map<string, number>();
  for (const e of fes) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const files = [...inMod].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b));
  const keep = new Set(files.slice(0, MAX_FILES));
  for (const p of keep) {
    const id = nodeId.file(p);
    const n = notes(p);
    nodes.push({
      id,
      label: base(p),
      sub: p,
      kind: 'file',
      canDrill: true,
      hint: `${plural(info.get(p)?.symbols ?? 0, 'declaration')}. Open it to see its functions and how they call each other.`,
      ...(n ? { badge: `✎ ${n}` } : {}),
    });
    targets.set(id, { kind: 'file', path: p });
  }
  // Within the module: file to file. Across modules: grouped onto the other module's node.
  const groups = new Map<string, { from: string; to: string; list: FileEdge[]; real: [string, string] }>();
  const add = (from: string, to: string, e: FileEdge) => {
    const k = `${from}>${to}`;
    const g = groups.get(k) ?? { from, to, list: [], real: [e.from, e.to] };
    g.list.push(e);
    groups.set(k, g);
  };
  const others = new Map<string, number>();
  for (const e of fes) {
    const a = keep.has(e.from);
    const b = keep.has(e.to);
    if (a && b) add(nodeId.file(e.from), nodeId.file(e.to), e);
    else if (a && moduleOf(e.to) && moduleOf(e.to) !== moduleKey) {
      add(nodeId.file(e.from), nodeId.module(moduleOf(e.to)!), e);
      others.set(moduleOf(e.to)!, 1);
    } else if (b && moduleOf(e.from) && moduleOf(e.from) !== moduleKey) {
      add(nodeId.module(moduleOf(e.from)!), nodeId.file(e.to), e);
      others.set(moduleOf(e.from)!, 1);
    }
  }
  for (const key of others.keys()) {
    const m = arch.modules.find((x) => x.key === key);
    if (!m) continue;
    nodes.push({
      id: nodeId.module(key),
      label: m.name,
      sub: 'other module',
      kind: 'module',
      canDrill: true,
      hint: `Another module. Open it to see its files.`,
    });
    targets.set(nodeId.module(key), { kind: 'module', key, name: m.name, root: m.root });
  }
  for (const g of groups.values()) {
    const c = combine(g.list);
    const sameModule = g.from.startsWith('f:') && g.to.startsWith('f:');
    const id = `fe:${g.from}>${g.to}`;
    edges.push({
      id,
      from: g.from,
      to: g.to,
      label: c.label,
      provenance: c.provenance,
      hint: sameModule
        ? `First at ${base(c.first.from)}:${c.line}.`
        : `Between files of different modules, first at ${base(c.first.from)}:${c.line}.`,
    });
    targets.set(id, relationTarget(c.first.from, c.first.to, g.list, c.label));
  }
  if (kinds.has('packages')) {
    for (const [pkg, count] of topPackages(fg, keep, 4)) {
      const pid = nodeId.package(pkg);
      nodes.push(packageNode(pkg, count));
      targets.set(pid, { kind: 'package', name: pkg, database: DATABASE_PACKAGES.has(pkg) });
      for (const x of fg.externals)
        if (x.kind === 'calls' && x.package === pkg && keep.has(x.from))
          edges.push({
            id: `fp:${x.from}>${pkg}`,
            from: nodeId.file(x.from),
            to: pid,
            label: x.count > 1 ? `calls ×${x.count}` : 'calls',
            provenance: 'verified',
          });
    }
  }
  return {
    nodes,
    edges,
    targets,
    ...(inMod.length > keep.size
      ? {
          omitted: `${inMod.length - keep.size} less-connected files are not shown. Filter by name to find one.`,
        }
      : {}),
  };
}

// ---------------------------------------------------------------- architecture: file level (its functions)

const SYMBOL_KINDS = new Set(['function', 'method', 'class']);
const MAX_SYMBOLS = 28;
const EDGE_WORD: Record<FileOutlineView['symbolEdges'][number]['kind'], string> = {
  calls: 'calls',
  references: 'uses',
  route_handler: 'handles route',
};
const REASON: Record<string, string> = {
  no_declaration: 'no declaration was found for the called name',
  dynamic: 'the call is dynamic',
  callback_parameter: 'it calls a function it was given; which one depends on the caller',
  parse_error: 'the target file could not be parsed',
  external_package: 'it calls into a package',
};
export const reasonText = (r: string | null) => (r ? (REASON[r] ?? r.replace(/_/g, ' ')) : 'not followed');

export function buildFile(
  outline: FileOutlineView,
  notes: (key: string) => number,
  showUnknown: boolean,
): Built {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const targets = new Map<string, Target>();
  const own = outline.symbols.filter(
    (s) =>
      SYMBOL_KINDS.has(s.kind) || (s.exported && s.kind === 'variable') || s.tags.includes('route-handler'),
  );
  const ownIds = new Set(own.map((s) => s.id));
  const degree = new Map<string, number>();
  for (const e of outline.symbolEdges) {
    if (e.from.symbolId) degree.set(e.from.symbolId, (degree.get(e.from.symbolId) ?? 0) + 1);
    if (e.to.symbolId) degree.set(e.to.symbolId, (degree.get(e.to.symbolId) ?? 0) + 1);
  }
  const keepOwn = [...own]
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.startLine - b.startLine)
    .slice(0, MAX_SYMBOLS);
  const keep = new Set(keepOwn.map((s) => s.id));
  for (const s of keepOwn) {
    const id = nodeId.symbol(s.id);
    const n = s.key ? notes(s.key) : 0;
    nodes.push({
      id,
      label: s.kind === 'class' ? s.name : `${s.name}()`,
      sub: `${s.kind}${s.exported ? ' · exported' : ''} · line ${s.startLine}`,
      kind: 'symbol',
      hint: s.signature ?? undefined,
      ...(n ? { badge: `✎ ${n}` } : {}),
    });
    targets.set(id, {
      kind: 'symbol',
      id: s.id,
      key: s.key,
      name: s.name,
      path: outline.path,
      line: s.startLine,
      endLine: s.endLine,
    });
  }
  const topId = `top:${outline.path}`;
  const ensureTop = () => {
    if (targets.has(topId)) return;
    nodes.push({ id: topId, label: 'Top-level code', sub: base(outline.path), kind: 'symbol' });
    targets.set(topId, { kind: 'file', path: outline.path });
  };
  const ensureForeign = (symbolId: string, name: string, path: string, line: number | null) => {
    const id = nodeId.symbol(symbolId);
    if (targets.has(id)) return id;
    nodes.push({
      id,
      label: name,
      sub: `${base(path)}${line ? `:${line}` : ''}`,
      kind: 'symbol',
      hint: path,
    });
    targets.set(id, { kind: 'symbol', id: symbolId, key: null, name, path, line: line ?? 1 });
    return id;
  };
  const unknownBySource = new Map<string, { reasons: Set<string>; line: number; count: number }>();
  const pairs = new Map<
    string,
    {
      from: string;
      to: string;
      words: Map<string, number>;
      e: FileOutlineView['symbolEdges'][number];
      prov: Prov;
    }
  >();
  for (const e of outline.symbolEdges) {
    const fromOwn = e.from.path === outline.path;
    // Skip what can't be drawn before creating any node, so no node is left without its edge.
    if (!e.to.symbolId && (e.to.external || !showUnknown || !fromOwn)) continue;
    if (e.to.symbolId && e.to.path === outline.path && !keep.has(e.to.symbolId)) continue;
    if (fromOwn && e.from.symbolId && !keep.has(e.from.symbolId)) continue;
    if (!fromOwn && !e.from.symbolId) continue;
    let from: string;
    if (fromOwn) {
      if (e.from.symbolId && keep.has(e.from.symbolId)) from = nodeId.symbol(e.from.symbolId);
      else if (!e.from.symbolId) {
        ensureTop();
        from = topId;
      } else if (ownIds.has(e.from.symbolId))
        continue; // a declaration left out to keep the graph readable
      else continue;
    } else if (e.from.symbolId) from = ensureForeign(e.from.symbolId, e.from.name ?? '?', e.from.path, null);
    else continue;
    let to: string;
    if (e.to.symbolId) {
      if (e.to.path === outline.path) {
        if (!keep.has(e.to.symbolId)) continue;
        to = nodeId.symbol(e.to.symbolId);
      } else to = ensureForeign(e.to.symbolId, e.to.name ?? '?', e.to.path ?? '', e.to.line);
    } else if (e.to.external) {
      continue; // package calls are shown in the module and dependency views
    } else {
      if (!showUnknown || !fromOwn) continue;
      const u = unknownBySource.get(from) ?? { reasons: new Set<string>(), line: e.line, count: 0 };
      u.reasons.add(reasonText(e.reason));
      u.count++;
      unknownBySource.set(from, u);
      continue;
    }
    if (from === to) continue;
    const k = `${from}>${to}`;
    const p = pairs.get(k) ?? { from, to, words: new Map(), e, prov: 'verified' as Prov };
    const w = e.kind === 'references' && e.jsx ? 'renders' : EDGE_WORD[e.kind];
    p.words.set(w, (p.words.get(w) ?? 0) + 1);
    if (e.provenance !== 'verified') p.prov = 'pattern';
    pairs.set(k, p);
  }
  for (const p of pairs.values()) {
    const label = [...p.words].map(([w, n]) => (n > 1 ? `${w} ×${n}` : w)).join(', ');
    const id = `se:${p.from}>${p.to}`;
    edges.push({
      id,
      from: p.from,
      to: p.to,
      label,
      provenance: p.prov,
      hint: `At ${base(p.e.from.path)}:${p.e.line}.`,
    });
    targets.set(id, {
      kind: 'relation',
      label: `${p.e.from.name ?? 'top level'} → ${p.e.to.name ?? '?'}: ${label}`,
      from: p.e.from.path,
      to: p.e.to.path ?? p.e.from.path,
      path: p.e.from.path,
      line: p.e.line,
      provenance: p.prov,
      noteKey: `${p.e.from.path}#${p.e.from.name ?? ''}|${p.e.kind}|${p.e.to.path ?? ''}#${p.e.to.name ?? ''}`,
    });
  }
  for (const [from, u] of unknownBySource) {
    const id = `u:${from}`;
    const reasons = [...u.reasons].join('; ');
    nodes.push({
      id,
      label: `Not followed (${u.count})`,
      sub: 'calls the analysis could not resolve',
      kind: 'unknown',
      provenance: 'unknown',
      hint: `Why: ${reasons}.`,
    });
    targets.set(id, {
      kind: 'unknown',
      label: `${u.count} calls not followed`,
      path: outline.path,
      line: u.line,
      reason: reasons,
    });
    edges.push({ id: `ue:${from}`, from, to: id, label: 'calls ?', provenance: 'unknown', hint: reasons });
  }
  return {
    nodes,
    edges,
    targets,
    ...(own.length > keep.size
      ? { omitted: `${own.length - keep.size} less-connected declarations are not shown.` }
      : {}),
  };
}

// ---------------------------------------------------------------- dependencies of one file

export function buildDependencies(
  fg: FileGraphView,
  focus: string,
  notes: (key: string) => number,
  kinds: Set<string>,
): Built {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const targets = new Map<string, Target>();
  const fixedRank = new Map<string, number>();
  const info = new Map(fg.files.map((f) => [f.path, f]));
  const shown = (fe: FileEdge) => kinds.has(KIND_WORD(fe) === 'renders' ? 'uses' : KIND_WORD(fe));
  const fileNode = (p: string, rank: number, current = false) => {
    const id = nodeId.file(p);
    if (targets.has(id)) return id;
    const n = notes(p);
    nodes.push({
      id,
      label: base(p),
      sub: p,
      kind: current ? 'current' : 'file',
      hint: current
        ? 'The file open in the code viewer.'
        : `${plural(info.get(p)?.symbols ?? 0, 'declaration')}.`,
      ...(n ? { badge: `✎ ${n}` } : {}),
    });
    targets.set(id, { kind: 'file', path: p });
    fixedRank.set(id, rank);
    return id;
  };
  const centre = fileNode(focus, 1, true);
  const outgoing = new Map<string, FileEdge[]>();
  const incoming = new Map<string, FileEdge[]>();
  for (const e of fg.edges) {
    if (!shown(e)) continue;
    if (e.from === focus) outgoing.set(e.to, [...(outgoing.get(e.to) ?? []), e]);
    else if (e.to === focus) incoming.set(e.from, [...(incoming.get(e.from) ?? []), e]);
  }
  for (const [p, list] of incoming) {
    const id = fileNode(p, outgoing.has(p) ? 2 : 0);
    const c = combine(list);
    const eid = `de:${p}>${focus}`;
    edges.push({
      id: eid,
      from: id,
      to: centre,
      label: c.label,
      provenance: c.provenance,
      hint: `At ${base(p)}:${c.line}.`,
    });
    targets.set(eid, relationTarget(p, focus, list, c.label));
  }
  for (const [p, list] of outgoing) {
    const id = fileNode(p, 2);
    const c = combine(list);
    const eid = `de:${focus}>${p}`;
    edges.push({
      id: eid,
      from: centre,
      to: id,
      label: c.label,
      provenance: c.provenance,
      hint: `At ${base(focus)}:${c.line}.`,
    });
    targets.set(eid, relationTarget(focus, p, list, c.label));
  }
  if (kinds.has('packages')) {
    const pk = new Map<string, { imports: number; calls: number }>();
    for (const x of fg.externals) {
      if (x.from !== focus) continue;
      const v = pk.get(x.package) ?? { imports: 0, calls: 0 };
      v[x.kind] += x.count;
      pk.set(x.package, v);
    }
    for (const [pkg, v] of pk) {
      const pid = nodeId.package(pkg);
      nodes.push(packageNode(pkg, v.calls));
      targets.set(pid, { kind: 'package', name: pkg, database: DATABASE_PACKAGES.has(pkg) });
      fixedRank.set(pid, 2);
      const label = [v.imports ? 'imports' : '', v.calls ? (v.calls > 1 ? `calls ×${v.calls}` : 'calls') : '']
        .filter(Boolean)
        .join(', ');
      edges.push({ id: `dp:${pkg}`, from: centre, to: pid, label, provenance: 'verified' });
    }
  }
  return { nodes, edges, targets, fixedRank };
}

// ---------------------------------------------------------------- function relationships of one symbol

export function buildFunction(rel: Relations, notes: (key: string) => number, showUnknown: boolean): Built {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const targets = new Map<string, Target>();
  const fixedRank = new Map<string, number>();
  const s = rel.symbol;
  if (!s) return { nodes, edges, targets };
  const centre = nodeId.symbol(s.id);
  const n = s.key ? notes(s.key) : 0;
  nodes.push({
    id: centre,
    label: `${s.name}()`,
    sub: `${base(s.path)}:${s.startLine}`,
    kind: 'current',
    hint: s.signature ?? undefined,
    ...(n ? { badge: `✎ ${n}` } : {}),
  });
  targets.set(centre, {
    kind: 'symbol',
    id: s.id,
    key: s.key,
    name: s.name,
    path: s.path,
    line: s.startLine,
    endLine: s.endLine,
  });
  fixedRank.set(centre, 1);
  const word = (via: string) => (via === 'route' ? 'handles route' : via === 'reference' ? 'uses' : 'calls');
  const add = (item: Relations['calls'][number], side: 'in' | 'out') => {
    const id = item.symbolId ? nodeId.symbol(item.symbolId) : `r:${item.path}:${item.line}:${item.label}`;
    if (!targets.has(id)) {
      nodes.push({
        id,
        label: item.label,
        sub: `${base(item.path)}:${item.line}`,
        kind: 'symbol',
        hint: item.path,
      });
      targets.set(id, {
        kind: 'symbol',
        id: item.symbolId ?? null,
        key: null,
        name: item.label,
        path: item.path,
        line: item.line,
      });
      fixedRank.set(id, side === 'in' ? 0 : 2);
    }
    const eid = `fe:${side}:${id}:${item.line}`;
    const from = side === 'in' ? id : centre;
    const to = side === 'in' ? centre : id;
    if (edges.some((e) => e.from === from && e.to === to)) return;
    const prov: Prov = item.provenance === 'verified' ? 'verified' : 'pattern';
    edges.push({
      id: eid,
      from,
      to,
      label: word(item.via),
      provenance: prov,
      hint: `At ${base(item.path)}:${item.line}.`,
    });
    const callerName = side === 'in' ? item.label : s.name;
    const calleeName = side === 'in' ? s.name : item.label;
    targets.set(eid, {
      kind: 'relation',
      label: `${callerName} → ${calleeName}: ${word(item.via)}`,
      from: side === 'in' ? item.path : s.path,
      to: side === 'in' ? s.path : item.path,
      path: side === 'in' ? item.path : s.path,
      line: side === 'in' ? item.line : item.line,
      provenance: prov,
      noteKey: `${side === 'in' ? item.path : s.path}#${callerName}|calls|${side === 'in' ? s.path : item.path}#${calleeName}`,
    });
  };
  rel.calledBy.forEach((i) => add(i, 'in'));
  rel.calls.forEach((i) => add(i, 'out'));
  if (showUnknown && rel.unresolved.length) {
    const id = `u:${s.id}`;
    const reasons = [...new Set(rel.unresolved.map((u) => u.reason))].join('; ');
    nodes.push({
      id,
      label: `Not followed (${rel.unresolved.length})`,
      sub: rel.unresolved
        .slice(0, 2)
        .map((u) => u.label)
        .join(', '),
      kind: 'unknown',
      provenance: 'unknown',
      hint: `Why: ${reasons}.`,
    });
    targets.set(id, {
      kind: 'unknown',
      label: `${rel.unresolved.length} calls not followed`,
      path: s.path,
      line: rel.unresolved[0]!.line,
      reason: reasons,
    });
    fixedRank.set(id, 2);
    edges.push({
      id: `ue:${s.id}`,
      from: centre,
      to: id,
      label: 'calls ?',
      provenance: 'unknown',
      hint: reasons,
    });
  }
  return { nodes, edges, targets, fixedRank };
}

// ---------------------------------------------------------------- request flow

export const STEP_KIND: Record<FlowStepView['kind'], string> = {
  client: 'Client call',
  route: 'Route',
  middleware: 'Middleware',
  handler: 'Handler',
  call: 'Calls',
  response: 'Response',
  unknown: 'Not followed',
};
const STEP_EDGE: Record<FlowStepView['kind'], string> = {
  client: 'requests',
  route: 'registered as',
  middleware: 'passes through',
  handler: 'handled by',
  call: 'calls',
  response: 'responds',
  unknown: 'not followed',
};

export const flowKey = (f: { method: string; routePath: string | null; name: string }) =>
  f.routePath ? `${f.method} ${f.routePath}` : f.name;

/**
 * A request flow as a top-to-bottom graph. A step hangs off the nearest earlier step with a smaller depth. Database
 * access is added only where a step's own function makes a verified call into a database package (`dbCalls`), and
 * it is labelled Likely because "database" is inferred from the package name.
 */
export function buildFlow(
  flow: FlowDetail,
  notes: (key: string) => number,
  dbCalls: Map<string, { pkg: string; line: number }[]>,
): Built {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const targets = new Map<string, Target>();
  const key = flowKey(flow);
  const stack: { depth: number; id: string }[] = [];
  flow.steps.forEach((s, i) => {
    const id = nodeId.step(i);
    const n = notes(`${key}#${i}`);
    nodes.push({
      id,
      label: `${i + 1}. ${s.label}`,
      sub: s.path ? `${STEP_KIND[s.kind]} · ${base(s.path)}${s.line ? `:${s.line}` : ''}` : STEP_KIND[s.kind],
      kind: s.kind === 'unknown' ? 'unknown' : 'step',
      provenance: s.provenance,
      hint:
        s.kind === 'unknown'
          ? `Not followed: ${s.reason ?? 'the analysis could not continue here'}.`
          : (s.path ?? undefined),
      ...(n ? { badge: `✎ ${n}` } : {}),
    });
    targets.set(id, { kind: 'step', flowKey: key, index: i, step: s });
    while (stack.length && stack[stack.length - 1]!.depth >= s.depth) stack.pop();
    const parent = stack[stack.length - 1] ?? (i > 0 ? { depth: -1, id: nodeId.step(i - 1) } : null);
    if (parent) {
      const eid = `fl:${parent.id}>${id}`;
      edges.push({
        id: eid,
        from: parent.id,
        to: id,
        label: STEP_EDGE[s.kind],
        provenance: s.provenance,
        ...(s.reason ? { hint: s.reason } : {}),
      });
    }
    stack.push({ depth: s.depth, id });
    if (s.symbolId)
      for (const c of dbCalls.get(s.symbolId) ?? []) {
        const pid = `db:${c.pkg}`;
        if (!targets.has(pid)) {
          nodes.push({
            id: pid,
            label: c.pkg,
            sub: 'database client · package',
            kind: 'database',
            provenance: 'pattern',
            hint: `Likely data access: ${s.label} calls into ${c.pkg}. The call is verified; the database is inferred from the package name.`,
          });
          targets.set(pid, { kind: 'package', name: c.pkg, database: true });
        }
        const eid = `fdb:${id}>${pid}`;
        if (!edges.some((e) => e.id === eid))
          edges.push({
            id: eid,
            from: id,
            to: pid,
            label: 'calls (database?)',
            provenance: 'pattern',
            hint: `At line ${c.line}.`,
          });
      }
  });
  return { nodes, edges, targets };
}
