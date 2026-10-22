import type { Depth, Provenance, Selection } from './schemas';

export type SnapshotStatus =
  | 'queued'
  | 'fetching'
  | 'filtering'
  | 'analysing'
  | 'summarising'
  | 'ready'
  | 'ready_partial'
  | 'failed'
  | 'expired';

export interface StageInfo {
  name: 'fetching' | 'filtering' | 'analysing' | 'summarising';
  state: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  ms?: number;
  progress?: { done: number; total: number };
}

export interface SnapshotView {
  id: string;
  repositoryId: string;
  repository: { owner: string; name: string };
  commitSha: string | null;
  status: SnapshotStatus;
  stages: StageInfo[];
  skippedCount: number;
  error: { code: string; message: string } | null;
  expiresAt: string;
}

export interface ImportResponse {
  repositoryId: string;
  snapshotId: string;
  status: SnapshotStatus;
  reused: boolean;
}

export interface TreeNode {
  name: string;
  type: 'dir' | 'file';
  path?: string;
  analysable?: boolean;
  children?: TreeNode[];
}

export interface FileView {
  path: string;
  language: string | null;
  lines: number;
  content: string;
  truncated: boolean;
  generated: boolean;
  analysable: boolean;
}

export type SelectionKind = 'function' | 'identifier' | 'block' | 'call' | 'import' | 'reference';

export interface SymbolRef {
  id: string;
  name: string;
  kind: string;
  path: string;
  startLine: number;
  endLine: number;
  signature?: string | null;
}

export interface ResolveResponse {
  kind: SelectionKind;
  symbol: SymbolRef | null;
  spansMultiple: boolean;
  /** Short note for the UI when resolution is approximate. */
  note?: string;
}

export interface RelationItem {
  symbolId?: string;
  label: string;
  path: string;
  line: number;
  provenance: Exclude<Provenance, 'explained'>;
  /** How the relation arises: a direct call, a use as a value (callback, JSX, export), or a route registration. */
  via: 'call' | 'reference' | 'route';
}

export interface UnresolvedItem {
  label: string;
  path: string;
  line: number;
  reason: string;
}

export interface Relations {
  symbol: { id: string; name: string; kind: string; signature: string | null } | null;
  definedIn: { path: string; line: number } | null;
  calledBy: RelationItem[];
  calls: RelationItem[];
  imports: { label: string; path?: string; external?: boolean; line: number }[];
  unresolved: UnresolvedItem[];
}

export interface Overview {
  facts: {
    languages: Record<string, number>;
    frameworks: string[];
    entryPoints: string[];
    fileCount: number;
    analysedCount: number;
    symbolCount: number;
    edgeCount: number;
    unresolvedCount: number;
  };
  startingPoints: { label: string; path: string; line: number; provenance: 'verified' }[];
  skipped: { path: string; reason: string }[];
  summary: {
    status: 'pending' | 'ready' | 'failed' | 'unavailable';
    text?: string;
    refs?: { path: string; line: number }[];
    provenance: 'explained';
  };
}

export interface HealthView {
  status: 'ok' | 'degraded';
  db: 'ok' | 'down';
  ai: 'configured' | 'not_configured' | 'test_provider';
  github: 'token' | 'anonymous';
  queueDepth: number;
  version: string;
}

export type { Depth, Selection };
