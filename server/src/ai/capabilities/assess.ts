import type { CheckBody, SelectionKind } from '@kyc/contracts';
import { KycError, verifyRefs } from '@kyc/core';
import { lineClaim, type Capability } from '../capability';
import { SYSTEM_RULES_VERSION, checkTask } from '../prompts';
import { CHECK_JSON_SCHEMA, normaliseCheck } from '../schemas';

export const assess: Capability<{ kind: SelectionKind; format: 'choice' | 'open' }, CheckBody> = {
  id: 'assess',
  version: `assess@3+${SYSTEM_RULES_VERSION}`,
  task: 'check',
  tier: 'fast',
  maxTokens: 700,
  intent: 'assess',
  budget: 6000,
  schema: CHECK_JSON_SCHEMA as unknown as Record<string, unknown>,
  prompt: (i) => ({ task: checkTask(i.format), input: { kind: i.kind, format: i.format } }),
  normalise: (raw, i) => normaliseCheck(raw, i.format),
  finalise(payload, pack, _i, stats) {
    const answerRefs = pack ? verifyRefs(payload.answerRefs, pack.ranges, stats) : [];
    // A check whose answer cannot be tied to the shown code is not answerable from the code: discard it.
    const choiceBroken =
      payload.format === 'choice' && (payload.correctIndex === undefined || payload.correctIndex > 3);
    if (answerRefs.length === 0 || choiceBroken)
      throw new KycError('AI_ERROR', "Couldn't make a good question for this selection.");
    const body = { ...payload, answerRefs };
    return { payload: body, claims: [lineClaim(body.explanation, answerRefs)] };
  },
};
