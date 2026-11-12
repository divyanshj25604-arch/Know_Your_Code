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
  /** Per-analysis-run row id: valid for this snapshot's current run only. */
  id: string;
  /**
   * Stable symbol key: the same for unchanged code across re-imports and re-analysis. Use it for anything that must
   * outlive a run (bookmarks, progress). Null only for rows analysed before keys existed.
   */
  key: string | null;
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
  /** Id of the graph edge that proves this relation (evidence for verified claims). */
  edgeId?: string;
}

export interface UnresolvedItem {
  label: string;
  path: string;
  line: number;
  reason: string;
}

export interface Relations {
  symbol: {
    id: string;
    key: string | null;
    name: string;
    kind: string;
    signature: string | null;
    path: string;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  } | null;
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
    modules?: { name: string; paths: string[] }[];
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

export interface AccountView {
  id: string;
  kind: 'anonymous' | 'registered';
  email: string | null;
}

/** Response to register and login. `token` is present only for `transport: 'bearer'`, exactly once. */
export interface AuthSessionResponse {
  user: AccountView;
  expiresAt: string;
  token?: string;
  /** Anonymous work in this browser that can be added to the account with POST /auth/claim. */
  claimable: { repositories: number } | null;
}

export interface MeResponse {
  user: AccountView | null;
}

export interface ClaimResponse {
  claimed: { repositories: number; snapshots: number; explanations: number };
}

/** A read-only link to one snapshot: send as the `x-kyc-share` header or `?share=` query parameter. */
export interface ShareTokenResponse {
  token: string;
  expiresAt: string;
}

export type { Depth, Selection };

export interface LearnerPositionView {
  path: string | null;
  symbolKey: string | null;
  startLine: number | null;
  endLine: number | null;
  commitSha: string | null;
  state: Record<string, unknown>;
  updatedAt: string;
}

export interface LearnerPositionsResponse {
  learning: LearnerPositionView | null;
  exploration: LearnerPositionView | null;
}

export interface BookmarkView {
  id: string;
  path: string;
  symbolKey: string | null;
  startLine: number | null;
  endLine: number | null;
  commitSha: string | null;
  label: string | null;
  note: string | null;
  createdAt: string;
}

/** A guided tour: an ordered set of stops computed from the code graph (P3.4). */
export interface TourView {
  stops: { path: string; line: number; title: string; why: string; symbolKey: string | null }[];
}

/** Architecture map of a snapshot (P3.1). `available` is false for snapshots analysed before module detection. */
export interface ArchitectureView {
  available: boolean;
  monorepo: boolean;
  modules: { key: string; name: string; kind: 'package' | 'directory'; root: string; files: string[] }[];
  dependencies: { from: string; to: string; imports: number }[];
}

/** Assessment results for one repository (P3.5): every check and every attempt, newest first. */
export interface AssessmentResults {
  summary: { checks: number; attempted: number; correct: number; averageScore: number | null };
  checks: {
    checkId: string;
    explanationId: string;
    question: string;
    type: string;
    format: 'choice' | 'open';
    createdAt: string;
    attempts: {
      id: string;
      answer: { answerIndex?: number; text?: string };
      verdict: 'correct' | 'partly' | 'incorrect';
      score: number;
      feedback: string;
      createdAt: string;
    }[];
  }[];
}

/** Programming concepts found in a snapshot's code (P3.3), each with real examples, different files first. */
export interface ConceptIndex {
  concepts: {
    id: string;
    label: string;
    count: number;
    files: number;
    examples: { symbolId: string; symbolKey: string | null; name: string; path: string; line: number }[];
  }[];
}

/** A step of a request flow (P3.2). Unknown steps carry the reason the analysis could not follow them. */
export type FlowStepKind = 'client' | 'route' | 'middleware' | 'handler' | 'call' | 'response' | 'unknown';

export interface FlowStepView {
  index: number;
  kind: FlowStepKind;
  label: string;
  path: string | null;
  line: number | null;
  symbolId: string | null;
  symbolKey: string | null;
  /** verified: a stored call edge (`edgeId`); pattern: a recognised Express or client pattern; unknown: not followed. */
  provenance: 'verified' | 'pattern' | 'unknown';
  depth: number;
  reason: string | null;
  edgeId: string | null;
}

export interface FlowSummary {
  id: string;
  name: string;
  method: string;
  routePath: string | null;
  clients: number;
  stepCount: number;
  unknownCount: number;
  handler: { symbolId: string; name: string; path: string; line: number } | null;
}

/** Request flows of a snapshot. `available` is false when it was analysed before flow discovery. */
export interface FlowsView {
  available: boolean;
  flows: FlowSummary[];
}

export interface FlowDetail extends FlowSummary {
  snapshotId: string;
  steps: FlowStepView[];
}

// ---------------------------------------------------------------- learning paths (P3.7)

/** The six MVP learning levels. */
export type LearningLevel =
  'project' | 'application' | 'concept' | 'exploration' | 'interactive' | 'validation';

/** A paragraph, or a reference to real code that opens in the viewer. */
export type LessonBlock =
  { type: 'text'; text: string } | { type: 'code'; path: string; line: number; label: string };

export type PathItemKind = 'lesson' | 'mission' | 'check';
export type ProgressStatus = 'not_started' | 'started' | 'completed';

/** One item of a learning path as the learner sees it (answers are never sent). */
export interface PathItemView {
  id: string;
  kind: PathItemKind;
  title: string;
  status: ProgressStatus;
  /** Lesson content. */
  blocks?: LessonBlock[];
  /** Mission: what to find in the code, answered by opening the place in the viewer. */
  goal?: string;
  hint?: string;
  /** Knowledge check. */
  question?: string;
  options?: string[];
}

export interface LearningPathView {
  id: string;
  level: LearningLevel;
  title: string;
  summary: string;
  status: ProgressStatus;
  items: PathItemView[];
}

export interface PathsView {
  paths: LearningPathView[];
}

export interface PathItemResult {
  correct: boolean;
  feedback: string;
  itemStatus: ProgressStatus;
  pathStatus: ProgressStatus;
  /** Where the answer is in the code (shown after a correct answer or to explain a wrong one). */
  refs: { path: string; line: number }[];
}
