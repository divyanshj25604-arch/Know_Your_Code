import type { CapabilityId, Claim, Ref } from '@kyc/contracts';
import type { ContextPack, RetrievalIntent, VerifyStats } from '@kyc/core';
import type { Tier } from './cost';
import type { LlmTask } from './llm';

/**
 * One AI capability (P2.3): everything that is specific to it — retrieval intent, prompt, output schema, version,
 * normalisation, fallback and verification. Model calls, retries, budget, streaming and the evidence envelope are
 * shared (executor.ts); persistence and HTTP are the service's and routes' concern.
 */
export interface Capability<I, P> {
  id: CapabilityId;
  /** Prompt + schema version. Bump on any change; it is part of cache keys and stored with every answer. */
  version: string;
  task: LlmTask;
  tier: Tier;
  maxTokens: number;
  /** Retrieval plan for the context pack (null: the capability builds its own context). */
  intent: RetrievalIntent | null;
  /** Context-pack token budget. */
  budget: number;
  schema: Record<string, unknown>;
  /** Task text and structured input for the user message. */
  prompt(input: I): { task: string; input: Record<string, unknown> };
  normalise(raw: unknown, input: I): P;
  /** Plain-text fallback when the model never returns valid JSON; null when not acceptable. */
  fallback?(text: string, input: I): P | null;
  /**
   * Check the payload against what the model was shown (references outside the pack are removed) and list its
   * claims. Claims are verified again by the executor; any `verified` claim without a valid edge is downgraded.
   */
  finalise(
    payload: P,
    pack: ContextPack | null,
    input: I,
    stats: VerifyStats,
  ): { payload: P; claims: Claim[] };
}

/** A model statement backed by line references: an `explained` claim. */
export function lineClaim(text: string, refs: Ref[]): Claim {
  return {
    text,
    provenance: 'explained',
    evidence: refs.map((r) => ({ kind: 'lines', path: r.path, line: r.line })),
  };
}

/** Plain text that was not valid JSON (the shared fallback rule). */
export const plainText = (t: string): string | null => {
  const s = t.trim();
  return s && !s.startsWith('{') ? s.slice(0, 1200) : null;
};
