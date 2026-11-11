import type { CheckBody, SelectionKind } from '@kyc/contracts';
import { KycError, verifyRefs } from '@kyc/core';
import { lineClaim, type Capability } from '../capability';
import { SYSTEM_RULES_VERSION, checkTask } from '../prompts';
import { CHECK_JSON_SCHEMA, normaliseCheck } from '../schemas';

export const assess: Capability<{ kind: SelectionKind }, CheckBody> = {
  id: 'assess',
  version: `assess@2+${SYSTEM_RULES_VERSION}`,
  task: 'check',
  tier: 'fast',
  maxTokens: 700,
  intent: 'assess',
  budget: 6000,
  schema: CHECK_JSON_SCHEMA as unknown as Record<string, unknown>,
  prompt: (i) => ({ task: checkTask(), input: { kind: i.kind } }),
  normalise: (raw) => normaliseCheck(raw),
  finalise(payload, pack, _i, stats) {
    const answerRefs = pack ? verifyRefs(payload.answerRefs, pack.ranges, stats) : [];
    // A check whose answer cannot be tied to the shown code is not answerable from the code: discard it.
    if (answerRefs.length === 0 || payload.correctIndex === undefined || payload.correctIndex > 3)
      throw new KycError('AI_ERROR', "Couldn't make a good question for this selection.");
    const body = { ...payload, answerRefs };
    return { payload: body, claims: [lineClaim(body.explanation, answerRefs)] };
  },
};
