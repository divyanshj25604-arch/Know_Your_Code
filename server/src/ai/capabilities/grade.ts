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
  /** Points a good answer makes (open questions). Empty: the expected answer is the single point. */
  rubric: string[];
  answer: string;
}

/** Rubric grading of a free-text answer to an understanding check, with cited evidence. */
export const grade: Capability<GradeInput, GradeBody> = {
  id: 'grade',
  version: `grade@2+${SYSTEM_RULES_VERSION}`,
  task: 'grade',
  tier: 'fast',
  maxTokens: 500,
  intent: 'assess',
  budget: 4000,
  schema: GRADE_JSON_SCHEMA as unknown as Record<string, unknown>,
  prompt: (i) => ({ task: gradeTask(), input: { ...i } }),
  normalise: (raw) => normaliseGrade(raw),
  finalise(payload, pack, i, stats) {
    const refs = pack ? verifyRefs(payload.refs, pack.ranges, stats) : [];
    // One judgement per expected point, in rubric order; the verdict follows from them, not from the model's label.
    const expected = i.rubric.length ? i.rubric : [i.expected];
    const points = expected.map((point, k) => ({
      point,
      met:
        payload.points.find((p) => p.point.trim().toLowerCase() === point.trim().toLowerCase())?.met ??
        payload.points[k]?.met ??
        false,
    }));
    const met = points.filter((p) => p.met).length;
    const verdict = met === points.length ? 'correct' : met > 0 ? 'partly' : 'incorrect';
    const body = { ...payload, points, verdict, refs } as const;
    return { payload: body, claims: [lineClaim(body.feedback, refs)] };
  },
};
