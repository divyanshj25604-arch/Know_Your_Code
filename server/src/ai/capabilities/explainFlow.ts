import type { Claim, Depth, FlowExplanationBody } from '@kyc/contracts';
import { verifyClaims, verifyRefs } from '@kyc/core';
import { lineClaim, type Capability } from '../capability';
import { SYSTEM_RULES_VERSION, flowTask } from '../prompts';
import { FLOW_JSON_SCHEMA, normaliseFlow } from '../schemas';

export interface FlowInput {
  depth: Depth;
  start: { name: string; path: string; line: number };
}

/**
 * Explain a call flow hop by hop. The model may mark a step `verified` only by citing an edge id from FLOW; the
 * verifier checks each against the edges actually shown and downgrades any other step to `explained`.
 */
export const explainFlow: Capability<FlowInput, FlowExplanationBody> = {
  id: 'explain_flow',
  version: `explain_flow@1+${SYSTEM_RULES_VERSION}`,
  task: 'flow',
  tier: 'fast',
  maxTokens: 1400,
  intent: 'flow',
  budget: 7000,
  schema: FLOW_JSON_SCHEMA as unknown as Record<string, unknown>,
  prompt: (i) => ({ task: flowTask(i.depth), input: { depth: i.depth, start: i.start } }),
  normalise: (raw) => normaliseFlow(raw),
  finalise(payload, pack, _i, stats) {
    if (!pack) return { payload, claims: [] };
    const summary = { ...payload.summary, refs: verifyRefs(payload.summary.refs, pack.ranges, stats) };
    const stepClaims: Claim[] = payload.steps.map((s) => ({
      text: s.text,
      provenance: s.provenance,
      evidence: [
        ...(s.edgeId
          ? [{ kind: 'edge' as const, edgeId: s.edgeId, type: 'call', from: '', to: '', path: '', line: 0 }]
          : []),
        ...s.refs.map((r) => ({ kind: 'lines' as const, path: r.path, line: r.line })),
      ],
    }));
    // Verify here as well so the payload the UI renders carries the corrected provenance and edge ids.
    const checked = verifyClaims(stepClaims, pack.ranges, pack.edges, stats);
    const steps = payload.steps.map((s, k) => {
      const c = checked.claims[k]!;
      const edge = c.evidence.find((e) => e.kind === 'edge');
      return {
        ...s,
        edgeId: edge && edge.kind === 'edge' ? edge.edgeId : null,
        provenance: c.provenance,
        refs: c.evidence.flatMap((e) => (e.kind === 'lines' ? [{ path: e.path, line: e.line }] : [])),
      };
    });
    return {
      payload: { ...payload, summary, steps },
      // Re-submit the original claims: the executor's verification counts the downgrades.
      claims: [lineClaim(summary.text, summary.refs), ...stepClaims],
    };
  },
};
