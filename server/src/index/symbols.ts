import { randomUUID } from 'node:crypto';
import type { Relations, RelationItem, SymbolRef } from '@kyc/contracts';
import type { Db } from '../db/pool';
import type { AnalysisResult } from '../analysis/types';

const BATCH = 500;

export async function persistAnalysis(
  db: Db,
  snapshotId: string,
  fileIds: Map<string, string>,
  result: AnalysisResult,
): Promise<{ symbols: number; edges: number }> {
  const idByKey = new Map<string, string>();
  for (const s of result.symbols) idByKey.set(s.key, randomUUID());

  for (let i = 0; i < result.symbols.length; i += BATCH) {
    const c = result.symbols.slice(i, i + BATCH);
    await db.query(
      `INSERT INTO symbols (id, snapshot_id, file_id, parent_symbol_id, name, qualified_name, kind, tags, exported, signature,
                            start_line, start_col, end_line, end_col)
       SELECT id, $1, file_id, parent_id, name, qn, kind, COALESCE(string_to_array(NULLIF(tags,''), ','), '{}'), exported, sig, sl, sc, el, ec
       FROM unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::text[], $7::text[], $8::text[], $9::bool[], $10::text[],
                   $11::int[], $12::int[], $13::int[], $14::int[])
            AS t(id, file_id, parent_id, name, qn, kind, tags, exported, sig, sl, sc, el, ec)`,
      [
        snapshotId,
        c.map((s) => idByKey.get(s.key)),
        c.map((s) => fileIds.get(s.path)),
        c.map((s) => (s.parentKey ? idByKey.get(s.parentKey) : null)),
        c.map((s) => s.name),
        c.map((s) => s.qualifiedName),
        c.map((s) => s.kind),
        c.map((s) => s.tags.join(',')),
        c.map((s) => s.exported),
        c.map((s) => s.signature),
        c.map((s) => s.startLine),
        c.map((s) => s.startCol),
        c.map((s) => s.endLine),
        c.map((s) => s.endCol),
      ],
    );
  }

  const edges = result.edges.filter((e) => fileIds.has(e.sourcePath));
  for (let i = 0; i < edges.length; i += BATCH) {
    const c = edges.slice(i, i + BATCH);
    await db.query(
      `INSERT INTO edges (snapshot_id, type, source_symbol_id, source_file_id, target_symbol_id, target_file_id, target_external,
                          line, provenance, reason, meta)
       SELECT $1, type, src, sf, tgt, tf, ext, line, prov, reason, meta::jsonb
       FROM unnest($2::text[], $3::uuid[], $4::uuid[], $5::uuid[], $6::uuid[], $7::text[], $8::int[], $9::text[], $10::text[], $11::text[])
            AS t(type, src, sf, tgt, tf, ext, line, prov, reason, meta)`,
      [
        snapshotId,
        c.map((e) => e.type),
        c.map((e) => (e.sourceKey ? idByKey.get(e.sourceKey) : null)),
        c.map((e) => fileIds.get(e.sourcePath)),
        c.map((e) => (e.targetKey ? idByKey.get(e.targetKey) : null)),
        c.map((e) => (e.targetPath ? (fileIds.get(e.targetPath) ?? null) : null)),
        c.map((e) => e.targetExternal),
        c.map((e) => e.line),
        c.map((e) => e.provenance),
        c.map((e) => e.reason),
        c.map((e) => JSON.stringify(e.meta)),
      ],
    );
  }
  return { symbols: result.symbols.length, edges: edges.length };
}

interface SymbolDbRow {
  id: string;
  name: string;
  qualified_name: string;
  kind: string;
  signature: string | null;
  path: string;
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
  tags: string[];
  exported: boolean;
  file_id: string;
  parent_symbol_id: string | null;
}

const SYMBOL_SELECT = `
  SELECT s.id, s.name, s.qualified_name, s.kind, s.signature, f.path, s.start_line, s.start_col, s.end_line, s.end_col,
         s.tags, s.exported, s.file_id, s.parent_symbol_id
  FROM symbols s JOIN files f ON f.id = s.file_id`;

const toRef = (r: SymbolDbRow): SymbolRef => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  path: r.path,
  startLine: r.start_line,
  endLine: r.end_line,
  signature: r.signature,
});

export async function getSymbol(
  db: Db,
  snapshotId: string,
  id: string,
): Promise<
  | (SymbolRef & {
      qualifiedName: string;
      tags: string[];
      fileId: string;
      exported: boolean;
      startCol: number;
      endCol: number;
      parentId: string | null;
    })
  | null
> {
  const r = await db.query<SymbolDbRow>(`${SYMBOL_SELECT} WHERE s.id=$1 AND s.snapshot_id=$2`, [
    id,
    snapshotId,
  ]);
  const x = r.rows[0];
  return x
    ? {
        ...toRef(x),
        qualifiedName: x.qualified_name,
        tags: x.tags,
        fileId: x.file_id,
        exported: x.exported,
        startCol: x.start_col,
        endCol: x.end_col,
        parentId: x.parent_symbol_id,
      }
    : null;
}

export async function getSymbolSnapshot(db: Db, id: string): Promise<string | null> {
  const r = await db.query<{ snapshot_id: string }>('SELECT snapshot_id FROM symbols WHERE id=$1', [id]);
  return r.rows[0]?.snapshot_id ?? null;
}

/**
 * Smallest function/method/class symbol that contains the selection. Parameters, imports and variables are not
 * "enclosing" scopes for explanation purposes.
 */
export async function enclosingSymbol(
  db: Db,
  snapshotId: string,
  path: string,
  sel: { startLine: number; startCol: number; endLine: number; endCol: number },
): Promise<SymbolRef | null> {
  const r = await db.query<SymbolDbRow>(
    `${SYMBOL_SELECT}
     WHERE s.snapshot_id=$1 AND f.path=$2 AND s.kind IN ('function','method','class')
       AND (s.start_line, s.start_col) <= ($3::int, $4::int) AND (s.end_line, s.end_col) >= ($5::int, $6::int)
     ORDER BY (s.end_line - s.start_line) ASC, (s.end_col - s.start_col) ASC LIMIT 1`,
    [snapshotId, path, sel.startLine, sel.startCol, sel.endLine, sel.endCol],
  );
  return r.rows[0] ? toRef(r.rows[0]) : null;
}

export async function symbolsInFile(
  db: Db,
  snapshotId: string,
  path: string,
  kinds: string[],
): Promise<(SymbolRef & { startCol: number; endCol: number })[]> {
  const r = await db.query<SymbolDbRow>(
    `${SYMBOL_SELECT} WHERE s.snapshot_id=$1 AND f.path=$2 AND s.kind = ANY($3::text[]) ORDER BY s.start_line, s.start_col`,
    [snapshotId, path, kinds],
  );
  return r.rows.map((x) => ({ ...toRef(x), startCol: x.start_col, endCol: x.end_col }));
}

const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);
const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

interface EdgeJoin {
  type: string;
  line: number;
  provenance: 'verified' | 'pattern';
  reason: string | null;
  meta: Record<string, unknown>;
  target_external: string | null;
  src_id: string | null;
  src_name: string | null;
  src_path: string;
  tgt_id: string | null;
  tgt_name: string | null;
  tgt_path: string | null;
  tgt_line: number | null;
}

const EDGE_SELECT = `
  SELECT e.type, e.line, e.provenance, e.reason, e.meta, e.target_external,
         ss.id AS src_id, ss.qualified_name AS src_name, sf.path AS src_path,
         ts.id AS tgt_id, ts.qualified_name AS tgt_name, tf.path AS tgt_path, ts.start_line AS tgt_line
  FROM edges e
  JOIN files sf ON sf.id = e.source_file_id
  LEFT JOIN symbols ss ON ss.id = e.source_symbol_id
  LEFT JOIN symbols ts ON ts.id = e.target_symbol_id
  LEFT JOIN files tf ON tf.id = e.target_file_id`;

function callerLabel(e: EdgeJoin): string {
  const who = e.src_name ?? `${e.src_path} (top level)`;
  if (e.type === 'route_handler')
    return `${String(e.meta.method ?? '')} ${String(e.meta.path ?? '')} route registration`.trim();
  if (e.type === 'references') return e.meta.jsx ? `${who} renders it` : `${who} uses it as a value`;
  return who;
}

export async function getRelations(db: Db, snapshotId: string, symbolId: string): Promise<Relations | null> {
  const sym = await getSymbol(db, snapshotId, symbolId);
  if (!sym) return null;

  const inbound = await db.query<EdgeJoin>(
    `${EDGE_SELECT} WHERE e.snapshot_id=$1 AND e.target_symbol_id=$2 AND e.type IN ('calls','references','route_handler')`,
    [snapshotId, symbolId],
  );
  const outbound = await db.query<EdgeJoin>(
    `${EDGE_SELECT} WHERE e.snapshot_id=$1 AND e.source_symbol_id=$2 AND e.type IN ('calls','route_handler')`,
    [snapshotId, symbolId],
  );
  const imports = await db.query<EdgeJoin>(
    `${EDGE_SELECT} WHERE e.snapshot_id=$1 AND e.type='imports' AND e.source_file_id=$2 ORDER BY e.line`,
    [snapshotId, sym.fileId],
  );

  const rank = (p: string) => (p === sym.path ? 1_000_000 : commonPrefix(dirOf(p), dirOf(sym.path)));
  const via = (t: string): RelationItem['via'] =>
    t === 'calls' ? 'call' : t === 'references' ? 'reference' : 'route';

  const calledBy: RelationItem[] = inbound.rows
    .sort((a, b) => rank(b.src_path) - rank(a.src_path) || a.line - b.line)
    .slice(0, 20)
    .map((e) => ({
      ...(e.src_id ? { symbolId: e.src_id } : {}),
      label: callerLabel(e),
      path: e.src_path,
      line: e.line,
      provenance: e.provenance,
      via: via(e.type),
    }));

  const calls: RelationItem[] = [];
  const seen = new Set<string>();
  const unresolved: Relations['unresolved'] = [];
  for (const e of outbound.rows) {
    if (e.type === 'calls' && e.tgt_id && e.tgt_path && !e.reason) {
      // One entry per callee, linking to where it is DEFINED (not the call site, which is in this symbol's own file).
      if (seen.has(e.tgt_id)) continue;
      seen.add(e.tgt_id);
      calls.push({
        symbolId: e.tgt_id,
        label: e.tgt_name ?? '',
        path: e.tgt_path,
        line: e.tgt_line ?? 1,
        provenance: e.provenance,
        via: 'call',
      });
    } else if (e.reason) {
      unresolved.push({
        label: String(e.meta.calleeText ?? e.meta.spec ?? e.target_external ?? '?'),
        path: e.src_path,
        line: e.line,
        reason:
          e.reason === 'external_package' && e.target_external
            ? `external_package:${e.target_external}`
            : e.reason,
      });
    }
  }
  // Calls: top 8 by proximity to the call-site's own file first; verified before pattern.

  return {
    symbol: {
      id: sym.id,
      name: sym.name,
      kind: sym.kind,
      signature: sym.signature ?? null,
      path: sym.path,
      startLine: sym.startLine,
      startCol: sym.startCol,
      endLine: sym.endLine,
      endCol: sym.endCol,
    },
    definedIn: { path: sym.path, line: sym.startLine },
    calledBy,
    calls: calls.slice(0, 30),
    imports: imports.rows.map((e) => ({
      label: String(e.meta.spec ?? e.target_external ?? e.tgt_path ?? ''),
      ...(e.tgt_path ? { path: e.tgt_path } : {}),
      ...(e.target_external ? { external: true } : {}),
      line: e.line,
    })),
    unresolved: unresolved.slice(0, 30),
  };
}

export async function getFileImports(
  db: Db,
  snapshotId: string,
  path: string,
): Promise<Relations['imports']> {
  const r = await db.query<EdgeJoin>(
    `${EDGE_SELECT} WHERE e.snapshot_id=$1 AND e.type='imports' AND sf.path=$2 ORDER BY e.line`,
    [snapshotId, path],
  );
  return r.rows.map((e) => ({
    label: String(e.meta.spec ?? e.target_external ?? e.tgt_path ?? ''),
    ...(e.tgt_path ? { path: e.tgt_path } : {}),
    ...(e.target_external ? { external: true } : {}),
    line: e.line,
  }));
}

/** Most-used functions/classes by inbound call + reference + route edges (starting points, docs/01 FR-OVR-03). */
export async function topSymbols(
  db: Db,
  snapshotId: string,
  limit: number,
): Promise<{ id: string; name: string; path: string; line: number; uses: number }[]> {
  const r = await db.query<{
    id: string;
    qualified_name: string;
    path: string;
    start_line: number;
    uses: number;
  }>(
    `SELECT s.id, s.qualified_name, f.path, s.start_line, count(*)::int AS uses
     FROM edges e JOIN symbols s ON s.id = e.target_symbol_id JOIN files f ON f.id = s.file_id
     WHERE e.snapshot_id=$1 AND e.type IN ('calls','references','route_handler')
       AND s.kind IN ('function','method','class') AND s.tags::text NOT LIKE '%callback%'
       AND f.path !~* '(^|/)(tests?|__tests__|spec|specs|e2e|fixtures?|mocks?)/|\.(test|spec)\.[a-z]+$'
     GROUP BY s.id, s.qualified_name, f.path, s.start_line ORDER BY uses DESC, f.path, s.start_line LIMIT $2`,
    [snapshotId, limit],
  );
  return r.rows.map((x) => ({
    id: x.id,
    name: x.qualified_name,
    path: x.path,
    line: x.start_line,
    uses: x.uses,
  }));
}

export async function counts(
  db: Db,
  snapshotId: string,
): Promise<{ symbols: number; edges: number; unresolved: number }> {
  const r = await db.query<{ symbols: number; edges: number; unresolved: number }>(
    `SELECT (SELECT count(*)::int FROM symbols WHERE snapshot_id=$1) AS symbols,
            (SELECT count(*)::int FROM edges WHERE snapshot_id=$1) AS edges,
            (SELECT count(*)::int FROM edges WHERE snapshot_id=$1 AND reason IS NOT NULL AND reason <> 'external_package') AS unresolved`,
    [snapshotId],
  );
  return r.rows[0]!;
}
