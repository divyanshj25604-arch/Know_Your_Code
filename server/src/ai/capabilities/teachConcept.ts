import type { ConceptBody } from '@kyc/contracts';
import { verifyRefs } from '@kyc/core';
import { lineClaim, type Capability } from '../capability';
import { SYSTEM_RULES_VERSION, conceptTask } from '../prompts';
import { CONCEPT_JSON_SCHEMA, normaliseConcept } from '../schemas';

export interface ConceptInput {
  conceptId: string;
  conceptLabel: string;
  previousExplanationSummary: string;
}

export const teachConcept: Capability<ConceptInput, ConceptBody> = {
  id: 'teach_concept',
  version: `teach_concept@2+${SYSTEM_RULES_VERSION}`,
  task: 'concept',
  tier: 'fast',
  maxTokens: 900,
  intent: 'concept',
  budget: 6000,
  schema: CONCEPT_JSON_SCHEMA as unknown as Record<string, unknown>,
  prompt: (i) => ({ task: conceptTask(i.conceptId, i.conceptLabel), input: { ...i } }),
  normalise: (raw) => normaliseConcept(raw),
  finalise(payload, pack, i, stats) {
    if (!pack) return { payload, claims: [] };
    const ok = verifyRefs(
      payload.inYourCode.map((x) => ({ path: x.path, line: x.line })),
      pack.ranges,
      stats,
    );
    const inYourCode = payload.inYourCode.filter((x) =>
      ok.some((r) => r.path === x.path && r.line === x.line),
    );
    const body: ConceptBody = { ...payload, concept: i.conceptId, inYourCode };
    return {
      payload: body,
      claims: inYourCode.map((x) => lineClaim(x.note, [{ path: x.path, line: x.line }])),
    };
  },
};
