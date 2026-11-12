import type { RelationItem, Relations } from '@kyc/contracts';
import type { GraphEdgeRow, GraphStore } from './graph';

const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);
const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};
const cmp = (a: string | number | null, b: string | number | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;

function callerLabel(e: GraphEdgeRow): string {
  const who = e.source.name ?? `${e.source.path} (top level)`;
  if (e.type === 'route_handler')
    return `${String(e.meta.method ?? '')} ${String(e.meta.path ?? '')} route registration`.trim();
  if (e.type === 'references') return e.meta.jsx ? `rendered by ${who}` : `used as a value in ${who}`;
  return who;
}

const via = (t: string): RelationItem['via'] =>
  t === 'calls' ? 'call' : t === 'references' ? 'reference' : 'route';

export function importItems(rows: GraphEdgeRow[]): Relations['imports'] {
  return rows.map((e) => ({
    label: String(e.meta.spec ?? e.targetExternal ?? e.target.path ?? ''),
    ...(e.target.path ? { path: e.target.path } : {}),
    ...(e.targetExternal ? { external: true } : {}),
    line: e.line,
  }));
}

/**
 * One-hop relations of a symbol: callers ranked by proximity (same file first, then shared directory depth), callees
 * once each at their definition, imports of its file, and what could not be resolved. Every verified relation carries
 * the id of the edge that proves it. Fully deterministic: every sort has a total tie-break.
 */
export async function relationsOf(store: GraphStore, symbolId: string): Promise<Relations | null> {
  const sym = await store.symbol(symbolId);
  if (!sym) return null;
  const [inbound, outbound, imports] = await Promise.all([
    store.inbound(symbolId),
    store.outbound(symbolId),
    store.fileImports(sym.path),
  ]);
  const rank = (p: string) => (p === sym.path ? 1_000_000 : commonPrefix(dirOf(p), dirOf(sym.path)));
  const calledBy: RelationItem[] = [...inbound]
    .sort(
      (a, b) =>
        rank(b.source.path) - rank(a.source.path) ||
        cmp(a.source.path, b.source.path) ||
        a.line - b.line ||
        cmp(a.id, b.id),
    )
    .slice(0, 20)
    .map((e) => ({
      ...(e.source.id ? { symbolId: e.source.id } : {}),
      label: callerLabel(e),
      path: e.source.path,
      line: e.line,
      provenance: e.provenance,
      via: via(e.type),
      edgeId: e.id,
    }));

  const calls: RelationItem[] = [];
  const seen = new Set<string>();
  const unresolved: Relations['unresolved'] = [];
  for (const e of outbound) {
    if (e.type === 'calls' && e.target.id && e.target.path && !e.reason) {
      // One entry per callee, linking to where it is DEFINED (not the call site).
      if (seen.has(e.target.id)) continue;
      seen.add(e.target.id);
      calls.push({
        symbolId: e.target.id,
        label: e.target.name ?? '',
        path: e.target.path,
        line: e.target.line ?? 1,
        provenance: e.provenance,
        via: 'call',
        edgeId: e.id,
      });
    } else if (e.reason) {
      unresolved.push({
        label: String(e.meta.calleeText ?? e.meta.spec ?? e.targetExternal ?? '?'),
        path: e.source.path,
        line: e.line,
        reason:
          e.reason === 'external_package' && e.targetExternal
            ? `external_package:${e.targetExternal}`
            : e.reason,
      });
    }
  }
  return {
    symbol: {
      id: sym.id,
      key: sym.key,
      name: sym.name,
      kind: sym.kind,
      signature: sym.signature,
      path: sym.path,
      startLine: sym.startLine,
      startCol: sym.startCol,
      endLine: sym.endLine,
      endCol: sym.endCol,
    },
    definedIn: { path: sym.path, line: sym.startLine },
    calledBy,
    calls: calls.slice(0, 30),
    imports: importItems(imports),
    unresolved: unresolved.slice(0, 30),
  };
}
