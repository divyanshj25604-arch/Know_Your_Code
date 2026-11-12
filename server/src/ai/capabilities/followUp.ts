import type { Depth, FollowUpBody } from '@kyc/contracts';
import { edgeClaims, verifyRefs } from '@kyc/core';
import { lineClaim, plainText, type Capability } from '../capability';
import { SYSTEM_RULES_VERSION, followupTask } from '../prompts';
import { FOLLOWUP_JSON_SCHEMA, normaliseFollowUp } from '../schemas';

export interface FollowUpInput {
  question: string;
  depth: Depth;
  previousExplanationSummary: string;
  recentThread: { role: string; text: string }[];
}

export const followUp: Capability<FollowUpInput, FollowUpBody> = {
  id: 'follow_up',
  version: `follow_up@2+${SYSTEM_RULES_VERSION}`,
  task: 'followup',
  tier: 'fast',
  maxTokens: 900,
  intent: 'followup',
  budget: 8000,
  schema: FOLLOWUP_JSON_SCHEMA as unknown as Record<string, unknown>,
  prompt: (i) => ({ task: followupTask(i.depth), input: { ...i } }),
  normalise: (raw) => normaliseFollowUp(raw),
  fallback: (text) => {
    const t = plainText(text);
    return t ? { text: t, refs: [], uncertainty: [] } : null;
  },
  finalise(payload, pack, _i, stats) {
    if (!pack) return { payload, claims: [] };
    const body = { ...payload, refs: verifyRefs(payload.refs, pack.ranges, stats) };
    return { payload: body, claims: [lineClaim(body.text, body.refs), ...edgeClaims(pack.edges)] };
  },
};
