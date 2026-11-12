import type { AnalysisResult, EdgeRow, SymbolRow } from '../analysis/types';
import type { GraphEdgeRow, GraphStore, GraphSymbol } from './graph';

/**
 * GraphStore over one analysis result held in memory. Symbol ids are their stable keys; edge ids are `e<index>`.
 * Ordering matches the Postgres store, so plans are identical whichever store serves them.
 */
export class MemoryGraphStore implements GraphStore {
  private readonly byId = new Map<string, SymbolRow>();
  private readonly text = new Map<string, string>();
  private readonly analysable = new Set<string>();
  private readonly edges: (EdgeRow & { id: string })[];

  constructor(files: { path: string; content: string; analysable?: boolean }[], result: AnalysisResult) {
    for (const s of result.symbols) this.byId.set(s.key, s);
    for (const f of files) {
      this.text.set(f.path, f.content);
      if (f.analysable !== false) this.analysable.add(f.path);
    }
    this.edges = result.edges.map((e, i) => ({ ...e, id: `e${i}` }));
  }

  private toSymbol(s: SymbolRow): GraphSymbol {
    return {
      id: s.key,
      key: s.key,
      name: s.qualifiedName,
      kind: s.kind,
      path: s.path,
      startLine: s.startLine,
      startCol: s.startCol,
      endLine: s.endLine,
      endCol: s.endCol,
      signature: s.signature,
    };
  }

  private row(e: EdgeRow & { id: string }): GraphEdgeRow {
    const src = e.sourceKey ? this.byId.get(e.sourceKey) : undefined;
    const tgt = e.targetKey ? this.byId.get(e.targetKey) : undefined;
    return {
      id: e.id,
      type: e.type,
      line: e.line,
      provenance: e.provenance,
      reason: e.reason,
      meta: e.meta,
      targetExternal: e.targetExternal,
      source: { id: src?.key ?? null, name: src?.qualifiedName ?? null, path: e.sourcePath },
      target: {
        id: tgt?.key ?? null,
        name: tgt?.qualifiedName ?? null,
        path: tgt?.path ?? e.targetPath,
        line: tgt?.startLine ?? null,
      },
    };
  }

  async symbol(id: string) {
    const s = this.byId.get(id);
    return s ? this.toSymbol(s) : null;
  }

  async inbound(symbolId: string) {
    return this.edges
      .filter(
        (e) =>
          e.targetKey === symbolId &&
          (e.type === 'calls' || e.type === 'references' || e.type === 'route_handler'),
      )
      .map((e) => this.row(e));
  }

  async outbound(symbolId: string) {
    return this.edges
      .filter((e) => e.sourceKey === symbolId && (e.type === 'calls' || e.type === 'route_handler'))
      .map((e) => this.row(e))
      .sort(byOutbound);
  }

  async fileImports(path: string) {
    return this.edges
      .filter((e) => e.type === 'imports' && e.sourcePath === path)
      .map((e) => this.row(e))
      .sort((a, b) => a.line - b.line || cmpId(a.id, b.id));
  }

  async fileText(path: string) {
    return this.text.get(path) ?? null;
  }

  async lexical(word: string, limit: number) {
    const w = word.toLowerCase();
    return [...this.text.entries()]
      .filter(([p, c]) => this.analysable.has(p) && c.toLowerCase().includes(w))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, limit)
      .map(([path, content]) => ({ path, content }));
  }
}

/** Numeric-aware id comparison (`e2` < `e10`; Postgres ids are numeric strings). */
export function cmpId(a: string, b: string): number {
  const na = Number(a.replace(/^\D+/, ''));
  const nb = Number(b.replace(/^\D+/, ''));
  return na - nb || (a < b ? -1 : a > b ? 1 : 0);
}

/** Outbound order shared by every store: call line, then callee path, callee line, edge id. */
export function byOutbound(a: GraphEdgeRow, b: GraphEdgeRow): number {
  const s = (x: string | null) => x ?? '￿';
  return (
    a.line - b.line ||
    (s(a.target.path) < s(b.target.path) ? -1 : s(a.target.path) > s(b.target.path) ? 1 : 0) ||
    (a.target.line ?? 0) - (b.target.line ?? 0) ||
    cmpId(a.id, b.id)
  );
}
