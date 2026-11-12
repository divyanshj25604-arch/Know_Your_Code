import type { EdgeType } from '../analysis/types';

/**
 * Read-only view of one snapshot's code graph (P2.4). The cloud runtime implements it over Postgres
 * (`server/src/index/graphStore.ts`); `MemoryGraphStore` implements it over an analysis result in memory (tests, and
 * the seam for a later local runtime). Every list is returned in a deterministic order.
 */
export interface GraphSymbol {
  /** Per-run row id. */
  id: string;
  /** Stable symbol key (null only for legacy rows). */
  key: string | null;
  /** Qualified name. */
  name: string;
  kind: string;
  path: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  signature: string | null;
}

export interface GraphEdgeRow {
  /** Edge id, citable as evidence. */
  id: string;
  type: EdgeType;
  line: number;
  provenance: 'verified' | 'pattern';
  reason: string | null;
  meta: Record<string, unknown>;
  targetExternal: string | null;
  source: { id: string | null; name: string | null; path: string };
  target: { id: string | null; name: string | null; path: string | null; line: number | null };
}

export interface GraphStore {
  symbol(id: string): Promise<GraphSymbol | null>;
  /** calls, references and route_handler edges that target the symbol. */
  inbound(symbolId: string): Promise<GraphEdgeRow[]>;
  /** calls and route_handler edges whose source is the symbol, ordered by (line, target path, target line, id). */
  outbound(symbolId: string): Promise<GraphEdgeRow[]>;
  /** imports edges of a file, ordered by line. */
  fileImports(path: string): Promise<GraphEdgeRow[]>;
  fileText(path: string): Promise<string | null>;
  /** Analysable files whose text contains `word` (case-insensitive), ordered by path. */
  lexical(word: string, limit: number): Promise<{ path: string; content: string }[]>;
}
