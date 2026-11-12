import { z } from 'zod';
import { RefSchema } from './schemas';

/**
 * The AI capability registry (P2.3). Every capability answers in one evidence-carrying envelope: its own payload
 * (the shape the UI renders) plus a list of claims, each tied to the evidence that supports it.
 */
export const CAPABILITY_IDS = [
  'explain_selection',
  'explain_flow',
  'teach_concept',
  'follow_up',
  'assess',
  'grade',
  'summarise_project',
] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** Evidence for a claim: source lines the model was shown, or a graph edge computed by static analysis. */
export type Evidence =
  | { kind: 'lines'; path: string; line: number }
  | { kind: 'edge'; edgeId: string; type: string; from: string; to: string; path: string; line: number };

/**
 * A statement in an answer. `verified` means a static-analysis edge proves it: a verified claim always carries at
 * least one edge the model was shown, otherwise it is downgraded to `explained` (model reasoning over cited lines).
 */
export interface Claim {
  text: string;
  provenance: 'verified' | 'explained';
  evidence: Evidence[];
}

export interface EvidenceEnvelope<P = unknown> {
  capability: CapabilityId;
  /** Capability prompt + schema version (part of every cache key). */
  version: string;
  model: string;
  payload: P;
  claims: Claim[];
  /** References removed because they pointed outside what the model was shown. */
  refsStripped: number;
  /** Claims marked verified by the model whose edge evidence did not check out. */
  claimsDowngraded: number;
  /** True when the model never produced valid structured output and a plain-text fallback is shown. */
  degraded: boolean;
}

/** Summary of an envelope, sent with the SSE `done` event and stored with the answer. */
export interface EvidenceSummary {
  capability: CapabilityId;
  version: string;
  claims: Claim[];
  claimsDowngraded: number;
}

export const FlowExplanationBodySchema = z.object({
  summary: z.object({ text: z.string(), refs: z.array(RefSchema).default([]) }),
  steps: z
    .array(
      z.object({
        edgeId: z.string().nullable().default(null),
        text: z.string(),
        refs: z.array(RefSchema).default([]),
        provenance: z.enum(['verified', 'explained']).default('explained'),
      }),
    )
    .default([]),
  uncertainty: z.array(z.object({ text: z.string() })).default([]),
});
export type FlowExplanationBody = z.infer<typeof FlowExplanationBodySchema>;

/** Rubric grading: which expected points the answer makes; the verdict and score are derived from them. */
export const GradeBodySchema = z.object({
  points: z.array(z.object({ point: z.string(), met: z.boolean() })).default([]),
  verdict: z.enum(['correct', 'partly', 'incorrect']),
  feedback: z.string(),
  refs: z.array(RefSchema).default([]),
});
export type GradeBody = z.infer<typeof GradeBodySchema>;

export const FlowExplainRequestSchema = z.object({
  snapshotId: z.string().uuid(),
  symbolId: z.string().uuid(),
  hops: z.number().int().min(1).max(4).default(3),
});
