/**
 * @kyc/core — runtime-independent Know Your Code logic, shared by the cloud server today and a local runtime later.
 *
 * Boundary (enforced by tsconfig.json and tests/boundary.test.ts): no Fastify, no `pg`, no `process.env`, no `node:*`
 * modules, no HTTP concepts. Dependencies: `@kyc/contracts` and `ts-morph` only. Persistence, workers, networking and
 * configuration belong to the runtime that hosts this package.
 */
export { KycError, isKycError } from './errors';

export { analyse, packageName, type AnalyseOptions } from './analysis/analyse';
export { buildProject, readPathAliases, toRelPath, PROJECT_ROOT, type PathAliases } from './analysis/project';
export type {
  AnalysisInput,
  AnalysisResult,
  Diagnostic,
  EdgeRow,
  EdgeType,
  SymbolKind,
  SymbolRow,
  UnresolvedReason,
} from './analysis/types';
export { classifySelection, lineStarts, toOffset, type Classified } from './analysis/classify';
export { buildOverview, type OverviewInput } from './analysis/overview';
export { detectConcepts } from './analysis/concepts';
export {
  detectModules,
  type ArchitectureMap,
  type ModuleDependency,
  type ModuleInfo,
} from './analysis/modules';
export { SYMBOL_KEY_VERSION, applyStableKeys, stableSymbolKeys } from './analysis/symbolKey';

/**
 * Identifies the analyser's output format. Bump when symbols, edges or names change for the same input, so analysis
 * runs made by different analysers can be told apart (recorded on every analysis run).
 */
export const ANALYSER_VERSION = 'core-2';

export {
  ANALYSABLE_EXT,
  SKIP_REASON_TEXT,
  classifyPath,
  extOf,
  isGeneratedContent,
  isGeneratedPath,
  languageOf,
  looksBinary,
  type PathVerdict,
  type SkipReason,
} from './files/filter';
export { REDACTED, isSecretFile, redact } from './privacy/redact';

export type { GraphEdgeRow, GraphStore, GraphSymbol } from './retrieval/graph';
export { importItems, relationsOf } from './retrieval/relations';
export { Pack, estimateTokens, isAllowed, mergeRanges, type AllowedRanges } from './retrieval/pack';
export {
  planContext,
  planExamples,
  type ContextPack,
  type EvidenceEdge,
  type FlowStep,
  type PlanRequest,
  type RetrievalIntent,
} from './retrieval/planner';
export { MemoryGraphStore, byOutbound, cmpId } from './retrieval/memoryStore';

export { edgeClaims, verifyClaims, verifyLines, verifyRefs, type VerifyStats } from './ai/verify';
