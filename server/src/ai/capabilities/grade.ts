import type { GradeBody } from '@kyc/contracts';
import { verifyRefs } from '@kyc/core';
import { lineClaim, type Capability } from '../capability';
import { SYSTEM_RULES_VERSION, gradeTask } from '../prompts';
import { GRADE_JSON_SCHEMA, normaliseGrade } from '../schemas';

export interface GradeInput {
  question: string;
  /** The expected answer: the correct option's text, or the check's explanation. */
  expected: string;
  explanation: string;
  answer: string;
}

/** Rubric grading of a free-text answer to an understanding check, with cited evidence. */
export const grade: Capability<GradeInput, GradeBody> = {
  id: 'grade',
  version: `grade@1+${SYSTEM_RULES_VERSION}`,
  task: 'grade',
  tier: 'fast',
  maxTokens: 500,
  intent: 'assess',
  budget: 4000,
  schema: GRADE_JSON_SCHEMA as unknown as Record<string, unknown>,
  prompt: (i) => ({ task: gradeTask(), input: { ...i } }),
  normalise: (raw) => normaliseGrade(raw),
  finalise(payload, pack, _i, stats) {
    const refs = pack ? verifyRefs(payload.refs, pack.ranges, stats) : [];
    const body = { ...payload, refs };
    return { payload: body, claims: [lineClaim(body.feedback, refs)] };
  },
};
