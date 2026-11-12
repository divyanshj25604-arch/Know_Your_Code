import type { FileGraphView, FileOutlineView } from '@kyc/contracts';
import { packageName } from '@kyc/core';
import type { Queryable } from '../db/pool';

/**
 * Explore graphs: a file-level view of a snapshot's current analysis run and one file's outline. Both only aggregate
 * stored files, symbols and edges; nothing is inferred. Symbol and edge rows are filtered to the snapshot's current
 * run so rows of an older run can never leak in.
 */

type Provenance = 'verified' | 'pattern';

/** Symbols that are not worth counting or listing as structure (they are parts of other declarations). */
const HIDDEN_KINDS = `('parameter', 'import')`;

export async function getFileGraph(q: Queryable, snapshotId: string): Promise<FileGraphView> {
  const files = await q.query<{ path: string; module: string | null; symbols: number; analysable: boolean }>(
    `SELECT f.path, f.analysable, mod.module_key AS module, COALESCE(sc.n, 0)::int AS symbols
     FROM snapshots s
     JOIN files f ON f.snapshot_id = s.id
     LEFT JOIN LATERAL (
       SELECT m.module_key FROM module_files mf JOIN modules m ON m.id = mf.module_id
       WHERE mf.file_id = f.id AND m.analysis_run_id = s.current_analysis_run_id
       ORDER BY m.module_key LIMIT 1
     ) mod ON true
     LEFT JOIN (
       SELECT y.file_id, count(*) AS n FROM symbols y JOIN snapshots s2 ON s2.id = y.snapshot_id
       WHERE y.snapshot_id = $1 AND y.analysis_run_id = s2.current_analysis_run_id
         AND y.kind NOT IN ${HIDDEN_KINDS}
       GROUP BY y.file_id
     ) sc ON sc.file_id = f.id
     WHERE s.id = $1 AND f.analysable
     ORDER BY f.path`,
    [snapshotId],
  );

  // Internal relationships: the target file is the imported file, or the file declaring the called/used symbol.
  // route_handler edges stay out (they are router → handler registrations, shown in flows and the outline).
  const edges = await q.query<{
    from_path: string;
    to_path: string;
    kind: 'imports' | 'calls' | 'references';
    count: number;
    line: number;
    verified: boolean;
    jsx: boolean | null;
  }>(
    `SELECT sf.path AS from_path, tf.path AS to_path, e.type AS kind, count(*)::int AS count, min(e.line) AS line,
            bool_and(e.provenance = 'verified') AS verified, bool_or(e.meta->>'jsx' = 'true') AS jsx
     FROM snapshots s
     JOIN edges e ON e.snapshot_id = s.id AND e.analysis_run_id = s.current_analysis_run_id
     JOIN files sf ON sf.id = e.source_file_id
     LEFT JOIN symbols ts ON ts.id = e.target_symbol_id
     JOIN files tf ON tf.id = CASE WHEN e.type = 'imports' THEN e.target_file_id ELSE ts.file_id END
     WHERE s.id = $1 AND e.type IN ('imports', 'calls', 'references') AND tf.id <> sf.id
     GROUP BY sf.path, tf.path, e.type
     ORDER BY sf.path, tf.path, e.type`,
    [snapshotId],
  );

  const ext = await q.query<{
    from_path: string;
    kind: 'imports' | 'calls';
    target: string;
    count: number;
    line: number;
  }>(
    `SELECT sf.path AS from_path, e.type AS kind,
            CASE WHEN e.type = 'calls' THEN COALESCE(e.meta->>'package', e.target_external) ELSE e.target_external END
              AS target,
            count(*)::int AS count, min(e.line) AS line
     FROM snapshots s
     JOIN edges e ON e.snapshot_id = s.id AND e.analysis_run_id = s.current_analysis_run_id
     JOIN files sf ON sf.id = e.source_file_id
     WHERE s.id = $1 AND e.type IN ('imports', 'calls') AND e.target_external IS NOT NULL
     GROUP BY 1, 2, 3`,
    [snapshotId],
  );
  // Normalise to the npm package name with the analyser's own rule (`@a/b/x` → `@a/b`, `lodash/fp` → `lodash`;
  // `node:` builtins keep their `node:` name, the client can filter them). That can merge two raw groups.
  const merged = new Map<string, FileGraphView['externals'][number]>();
  for (const r of ext.rows) {
    const pkg = packageName(r.target);
    const k = `${r.from_path}\0${pkg}\0${r.kind}`;
    const cur = merged.get(k);
    if (cur) {
      cur.count += r.count;
      cur.line = Math.min(cur.line, r.line);
    } else merged.set(k, { from: r.from_path, package: pkg, kind: r.kind, count: r.count, line: r.line });
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const externals = [...merged.values()].sort(
    (a, b) => cmp(a.from, b.from) || cmp(a.package, b.package) || cmp(a.kind, b.kind),
  );

  return {
    files: files.rows.map((f) => ({
      path: f.path,
      module: f.module,
      symbols: f.symbols,
      analysable: f.analysable,
    })),
    edges: edges.rows.map((e) => ({
      from: e.from_path,
      to: e.to_path,
      kind: e.kind,
      count: e.count,
      line: e.line,
      provenance: e.verified ? 'verified' : 'pattern',
      ...(e.kind === 'references' ? { jsx: e.jsx === true } : {}),
    })),
    externals,
  };
}

/** Upper bound on symbol-level edges in one outline: a huge file must not produce an unbounded response. */
export const OUTLINE_EDGE_LIMIT = 400;

/** One file's structure and neighbourhood, or null when the snapshot has no file at this path. */
export async function getFileOutline(
  q: Queryable,
  snapshotId: string,
  path: string,
): Promise<FileOutlineView | null> {
  const fr = await q.query<{
    id: string;
    language: string | null;
    analysable: boolean;
    line_count: number;
    run_id: string | null;
  }>(
    `SELECT f.id, f.language, f.analysable, f.line_count, s.current_analysis_run_id AS run_id
     FROM files f JOIN snapshots s ON s.id = f.snapshot_id WHERE f.snapshot_id = $1 AND f.path = $2`,
    [snapshotId, path],
  );
  const file = fr.rows[0];
  if (!file) return null;
  const params = [snapshotId, file.id, file.run_id];

  const mod = await q.query<{ module_key: string; name: string }>(
    `SELECT m.module_key, m.name FROM module_files mf JOIN modules m ON m.id = mf.module_id
     WHERE mf.file_id = $1 AND m.analysis_run_id = $2 ORDER BY m.module_key LIMIT 1`,
    [file.id, file.run_id],
  );

  const symbols = await q.query<{
    id: string;
    symbol_key: string | null;
    name: string;
    kind: string;
    tags: string[];
    start_line: number;
    end_line: number;
    exported: boolean;
    signature: string | null;
    parent_symbol_id: string | null;
  }>(
    `SELECT id, symbol_key, name, kind, tags, start_line, end_line, exported, signature, parent_symbol_id
     FROM symbols WHERE snapshot_id = $1 AND file_id = $2 AND analysis_run_id = $3 AND kind NOT IN ${HIDDEN_KINDS}
     ORDER BY start_line, start_col, id`,
    params,
  );

  const imports = await q.query<{
    path: string | null;
    external: string | null;
    line: number;
    provenance: Provenance;
  }>(
    `SELECT tf.path, e.target_external AS external, e.line, e.provenance
     FROM edges e LEFT JOIN files tf ON tf.id = e.target_file_id
     WHERE e.snapshot_id = $1 AND e.source_file_id = $2 AND e.analysis_run_id = $3 AND e.type = 'imports'
     ORDER BY e.line, e.id`,
    params,
  );

  // One entry per importing file, at its first import line.
  const importedBy = await q.query<{ path: string; line: number; provenance: Provenance }>(
    `SELECT DISTINCT ON (sf.path) sf.path, e.line, e.provenance
     FROM edges e JOIN files sf ON sf.id = e.source_file_id
     WHERE e.snapshot_id = $1 AND e.target_file_id = $2 AND e.analysis_run_id = $3 AND e.type = 'imports'
       AND e.source_file_id <> $2
     ORDER BY sf.path, e.line, e.id`,
    params,
  );

  // Calls, references and route registrations with either end in this file: this file's own edges first, then the
  // incoming ones, each by line. Capped at OUTLINE_EDGE_LIMIT (400) rows.
  const symbolEdges = await q.query<{
    id: string;
    kind: 'calls' | 'references' | 'route_handler';
    line: number;
    provenance: Provenance;
    reason: string | null;
    jsx: boolean;
    target_external: string | null;
    src_id: string | null;
    src_name: string | null;
    src_path: string;
    tgt_id: string | null;
    tgt_name: string | null;
    tgt_path: string | null;
    tgt_line: number | null;
  }>(
    `SELECT e.id::text AS id, e.type AS kind, e.line, e.provenance, e.reason, (e.meta->>'jsx' = 'true') AS jsx,
            e.target_external, ss.id AS src_id, ss.qualified_name AS src_name, sf.path AS src_path,
            ts.id AS tgt_id, ts.qualified_name AS tgt_name, COALESCE(tsf.path, tf.path) AS tgt_path,
            ts.start_line AS tgt_line
     FROM edges e
     JOIN files sf ON sf.id = e.source_file_id
     LEFT JOIN symbols ss ON ss.id = e.source_symbol_id
     LEFT JOIN symbols ts ON ts.id = e.target_symbol_id
     LEFT JOIN files tsf ON tsf.id = ts.file_id
     LEFT JOIN files tf ON tf.id = e.target_file_id
     WHERE e.snapshot_id = $1 AND e.analysis_run_id = $3 AND e.type IN ('calls', 'references', 'route_handler')
       AND (e.source_file_id = $2 OR e.target_symbol_id IN (
             SELECT y.id FROM symbols y WHERE y.snapshot_id = $1 AND y.file_id = $2 AND y.analysis_run_id = $3))
     ORDER BY (e.source_file_id <> $2), e.line, e.id
     LIMIT ${OUTLINE_EDGE_LIMIT}`,
    params,
  );

  return {
    path,
    language: file.language,
    analysable: file.analysable,
    lines: file.line_count,
    module: mod.rows[0] ? { key: mod.rows[0].module_key, name: mod.rows[0].name } : null,
    symbols: symbols.rows.map((s) => ({
      id: s.id,
      key: s.symbol_key,
      name: s.name,
      kind: s.kind,
      tags: s.tags,
      startLine: s.start_line,
      endLine: s.end_line,
      exported: s.exported,
      signature: s.signature,
      parentId: s.parent_symbol_id,
    })),
    imports: imports.rows.map((i) => ({
      path: i.path,
      external: i.external,
      line: i.line,
      provenance: i.provenance,
    })),
    importedBy: importedBy.rows.map((i) => ({ path: i.path, line: i.line, provenance: i.provenance })),
    symbolEdges: symbolEdges.rows.map((e) => ({
      id: e.id,
      kind: e.kind,
      from: { symbolId: e.src_id, name: e.src_name, path: e.src_path },
      to: {
        symbolId: e.tgt_id,
        name: e.tgt_name,
        path: e.tgt_path,
        line: e.tgt_line,
        external: e.target_external,
      },
      line: e.line,
      provenance: e.provenance,
      reason: e.reason,
      ...(e.kind === 'references' ? { jsx: e.jsx === true } : {}),
    })),
  };
}
