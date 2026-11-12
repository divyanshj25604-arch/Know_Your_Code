import { byOutbound, cmpId, type GraphEdgeRow, type GraphStore, type GraphSymbol } from '@kyc/core';
import type { Queryable } from '../db/pool';
import { getFileContent } from './files';

interface EdgeDb {
  id: string;
  type: GraphEdgeRow['type'];
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
  SELECT e.id::text AS id, e.type, e.line, e.provenance, e.reason, e.meta, e.target_external,
         ss.id AS src_id, ss.qualified_name AS src_name, sf.path AS src_path,
         ts.id AS tgt_id, ts.qualified_name AS tgt_name, tf.path AS tgt_path, ts.start_line AS tgt_line
  FROM edges e
  JOIN files sf ON sf.id = e.source_file_id
  LEFT JOIN symbols ts ON ts.id = e.target_symbol_id
  LEFT JOIN symbols ss ON ss.id = e.source_symbol_id
  LEFT JOIN files tf ON tf.id = e.target_file_id`;

const toRow = (e: EdgeDb): GraphEdgeRow => ({
  id: e.id,
  type: e.type,
  line: e.line,
  provenance: e.provenance,
  reason: e.reason,
  meta: e.meta,
  targetExternal: e.target_external,
  source: { id: e.src_id, name: e.src_name, path: e.src_path },
  target: { id: e.tgt_id, name: e.tgt_name, path: e.tgt_path, line: e.tgt_line },
});

/** The code graph of one snapshot in Postgres (P2.4). Ordering matches MemoryGraphStore in @kyc/core. */
export class PgGraphStore implements GraphStore {
  constructor(
    private readonly db: Queryable,
    readonly snapshotId: string,
  ) {}

  async symbol(id: string): Promise<GraphSymbol | null> {
    const r = await this.db.query<{
      id: string;
      symbol_key: string | null;
      qualified_name: string;
      kind: string;
      path: string;
      start_line: number;
      start_col: number;
      end_line: number;
      end_col: number;
      signature: string | null;
    }>(
      `SELECT s.id, s.symbol_key, s.qualified_name, s.kind, f.path, s.start_line, s.start_col, s.end_line, s.end_col,
              s.signature
       FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.id=$1 AND s.snapshot_id=$2`,
      [id, this.snapshotId],
    );
    const s = r.rows[0];
    return s
      ? {
          id: s.id,
          key: s.symbol_key,
          name: s.qualified_name,
          kind: s.kind,
          path: s.path,
          startLine: s.start_line,
          startCol: s.start_col,
          endLine: s.end_line,
          endCol: s.end_col,
          signature: s.signature,
        }
      : null;
  }

  async inbound(symbolId: string) {
    const r = await this.db.query<EdgeDb>(
      `${EDGE_SELECT} WHERE e.snapshot_id=$1 AND e.target_symbol_id=$2 AND e.type IN ('calls','references','route_handler')
       ORDER BY e.id`,
      [this.snapshotId, symbolId],
    );
    return r.rows.map(toRow);
  }

  async outbound(symbolId: string) {
    const r = await this.db.query<EdgeDb>(
      `${EDGE_SELECT} WHERE e.snapshot_id=$1 AND e.source_symbol_id=$2 AND e.type IN ('calls','route_handler')`,
      [this.snapshotId, symbolId],
    );
    return r.rows.map(toRow).sort(byOutbound);
  }

  async fileImports(path: string) {
    const r = await this.db.query<EdgeDb>(
      `${EDGE_SELECT} WHERE e.snapshot_id=$1 AND e.type='imports' AND sf.path=$2`,
      [this.snapshotId, path],
    );
    return r.rows.map(toRow).sort((a, b) => a.line - b.line || cmpId(a.id, b.id));
  }

  async fileText(path: string) {
    return (await getFileContent(this.db, this.snapshotId, path))?.content ?? null;
  }

  async lexical(word: string, limit: number) {
    const r = await this.db.query<{ path: string; content: string }>(
      `SELECT path, content FROM files WHERE snapshot_id=$1 AND analysable AND content ILIKE $2 ORDER BY path LIMIT $3`,
      [this.snapshotId, `%${word.replace(/[%_\\]/g, '\\$&')}%`, limit],
    );
    return r.rows;
  }
}
