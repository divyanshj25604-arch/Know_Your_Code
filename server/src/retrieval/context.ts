import type { Selection } from '@kyc/contracts';
import { planContext, type ContextPack, type RetrievalIntent } from '@kyc/core';
import type { Queryable } from '../db/pool';
import type { ResolvedSelection } from '../index/resolve';
import { PgGraphStore } from '../index/graphStore';

export { estimateTokens, type ContextPack } from '@kyc/core';

interface BuildOpts {
  db: Queryable;
  snapshotId: string;
  selection: Selection;
  resolved: ResolvedSelection;
  intent?: RetrievalIntent;
  /** Follow-up question: enables lexical search. */
  question?: string;
  maxTokens: number;
  facts?: { frameworks: string[]; languages: Record<string, number> } | null;
  hops?: number;
}

/** Plan a context pack for a resolved selection with the @kyc/core planner over this snapshot's graph (P2.4). */
export async function buildContextPack(o: BuildOpts): Promise<ContextPack> {
  const store = new PgGraphStore(o.db, o.snapshotId);
  const focus = o.resolved.symbol ? await store.symbol(o.resolved.symbol.id) : null;
  return planContext(store, {
    intent: o.intent ?? (o.question ? 'followup' : 'explain'),
    selection: o.selection,
    focus,
    fileAnalysable: o.resolved.fileAnalysable,
    maxTokens: o.maxTokens,
    ...(o.question ? { question: o.question } : {}),
    ...(o.facts !== undefined ? { facts: o.facts } : {}),
    ...(o.hops ? { hops: o.hops } : {}),
  });
}
