export type SymbolKind = 'function' | 'method' | 'class' | 'variable' | 'parameter' | 'import' | 'export';

export interface SymbolRow {
  /** Stable within one analysis run: `${path}#${start}-${end}`. Replaced by a UUID on persistence. */
  key: string;
  path: string;
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  tags: string[];
  exported: boolean;
  signature: string | null;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  parentKey: string | null;
}

export type EdgeType = 'imports' | 'calls' | 'references' | 'route_handler';

export interface EdgeRow {
  type: EdgeType;
  sourceKey: string | null;
  sourcePath: string;
  targetKey: string | null;
  targetPath: string | null;
  targetExternal: string | null;
  line: number;
  provenance: 'verified' | 'pattern';
  /** Set when the relationship could not be resolved statically. */
  reason: UnresolvedReason | null;
  meta: Record<string, unknown>;
}

export type UnresolvedReason =
  | 'dynamic_import'
  | 'computed_member'
  | 'external_package'
  | 'parse_error'
  | 'no_declaration'
  | 'callback_parameter';

export interface Diagnostic {
  path: string;
  kind: 'syntax_error' | 'analysis_failed';
  message: string;
  line?: number;
}

export interface AnalysisInput {
  path: string;
  content: string;
}

export interface AnalysisResult {
  symbols: SymbolRow[];
  edges: EdgeRow[];
  diagnostics: Diagnostic[];
  /** Files that could not be analysed at all, with a reason. */
  failedFiles: { path: string; reason: string }[];
  timings: { projectMs: number; symbolsMs: number; edgesMs: number };
}
