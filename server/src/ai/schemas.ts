import { z } from 'zod';
import {
  CheckBodySchema,
  CONCEPT_VOCAB,
  ConceptBodySchema,
  FollowUpBodySchema,
  RefSchema,
  type CheckBody,
  type ConceptBody,
  type ExplanationBody,
  type FollowUpBody,
} from '@kyc/contracts';

/** Anthropic structured-output JSON schemas: all fields required, objects closed. Empty values mean "not applicable". */
const ref = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'line'],
  properties: { path: { type: 'string' }, line: { type: 'integer' } },
} as const;
const refs = { type: 'array', items: ref } as const;
const textRefs = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'refs'],
  properties: { text: { type: 'string' }, refs },
} as const;
const textList = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: { text: { type: 'string' } },
  },
} as const;

export const EXPLANATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'what',
    'why',
    'steps',
    'inputs',
    'dependsOn',
    'effects',
    'edgeCases',
    'concepts',
    'exploreNext',
    'tryIt',
    'uncertainty',
  ],
  properties: {
    what: textRefs,
    why: textRefs,
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'lines'],
        properties: { text: { type: 'string' }, lines: { type: 'array', items: { type: 'integer' } } },
      },
    },
    inputs: textRefs,
    dependsOn: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
    effects: textRefs,
    edgeCases: { type: 'array', items: textRefs },
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label'],
        properties: { id: { type: 'string' }, label: { type: 'string' } },
      },
    },
    exploreNext: textList,
    tryIt: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'text'],
      properties: { type: { type: 'string', enum: ['predict', 'explain'] }, text: { type: 'string' } },
    },
    uncertainty: textList,
  },
} as const;

export const FOLLOWUP_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'refs', 'uncertainty'],
  properties: { text: { type: 'string' }, refs, uncertainty: textList },
} as const;

export const CONCEPT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['concept', 'plain', 'term', 'inYourCode', 'spotIt', 'backToCode'],
  properties: {
    concept: { type: 'string' },
    plain: { type: 'string' },
    term: { type: 'string' },
    inYourCode: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'line', 'note'],
        properties: { path: { type: 'string' }, line: { type: 'integer' }, note: { type: 'string' } },
      },
    },
    spotIt: {
      type: 'object',
      additionalProperties: false,
      required: ['question'],
      properties: { question: { type: 'string' } },
    },
    backToCode: { type: 'string' },
  },
} as const;

export const CHECK_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'question', 'options', 'correctIndex', 'answerRefs', 'explanation'],
  properties: {
    type: { type: 'string', enum: ['predict', 'trace', 'why'] },
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    correctIndex: { type: 'integer' },
    answerRefs: refs,
    explanation: { type: 'string' },
  },
} as const;

export const OVERVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'modules', 'refs'],
  properties: {
    summary: { type: 'string' },
    modules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'paths'],
        properties: { name: { type: 'string' }, paths: { type: 'array', items: { type: 'string' } } },
      },
    },
    refs,
  },
} as const;

const conceptIds = new Set<string>(CONCEPT_VOCAB);

/** Validate the model's raw explanation JSON and normalise "empty = absent" into the contract shape. */
const RawExplanation = z.object({
  what: z.object({ text: z.string(), refs: z.array(RefSchema).default([]) }),
  why: z.object({ text: z.string(), refs: z.array(RefSchema).default([]) }).optional(),
  steps: z.array(z.object({ text: z.string(), lines: z.array(z.number().int()).default([]) })).default([]),
  inputs: z.object({ text: z.string(), refs: z.array(RefSchema).default([]) }).optional(),
  dependsOn: z.object({ text: z.string() }).optional(),
  effects: z.object({ text: z.string(), refs: z.array(RefSchema).default([]) }).optional(),
  edgeCases: z.array(z.object({ text: z.string(), refs: z.array(RefSchema).default([]) })).default([]),
  concepts: z.array(z.object({ id: z.string(), label: z.string() })).default([]),
  exploreNext: z.array(z.object({ text: z.string() })).default([]),
  tryIt: z.object({ type: z.enum(['predict', 'explain']), text: z.string() }).optional(),
  uncertainty: z.array(z.object({ text: z.string() })).default([]),
});

export class ModelOutputError extends Error {}

export function normaliseExplanation(raw: unknown, kind: string): ExplanationBody {
  const r = RawExplanation.safeParse(raw);
  if (!r.success)
    throw new ModelOutputError(`explanation schema: ${r.error.issues[0]?.message ?? 'invalid'}`);
  const v = r.data;
  if (v.what.text.trim().length === 0) throw new ModelOutputError('explanation has an empty "what"');
  const nonEmpty = <T extends { text: string }>(x: T | undefined): T | undefined =>
    x && x.text.trim() ? x : undefined;
  const out: ExplanationBody = {
    kind,
    sections: {
      what: v.what,
      ...(nonEmpty(v.why) ? { why: nonEmpty(v.why)! } : {}),
      ...(v.steps.filter((s) => s.text.trim()).length
        ? {
            steps: v.steps
              .filter((s) => s.text.trim())
              .map((s) => ({ text: s.text, lines: s.lines.slice(0, 2) })),
          }
        : {}),
      ...(nonEmpty(v.inputs) ? { inputs: nonEmpty(v.inputs)! } : {}),
      ...(nonEmpty(v.dependsOn) ? { dependsOn: nonEmpty(v.dependsOn)! } : {}),
      ...(nonEmpty(v.effects) ? { effects: nonEmpty(v.effects)! } : {}),
      ...(v.edgeCases.filter((e) => e.text.trim()).length
        ? { edgeCases: v.edgeCases.filter((e) => e.text.trim()) }
        : {}),
    },
    concepts: v.concepts.slice(0, 4).map((c) => ({
      id: conceptIds.has(c.id) || c.id.startsWith('other:') ? c.id : `other:${c.label || c.id}`,
      label: c.label || c.id,
    })),
    exploreNext: v.exploreNext
      .filter((e) => e.text.trim())
      .slice(0, 3)
      .map((e) => ({ type: 'question' as const, text: e.text })),
    ...(v.tryIt && v.tryIt.text.trim() ? { tryIt: v.tryIt } : {}),
    uncertainty: v.uncertainty.filter((u) => u.text.trim()),
  };
  return out;
}

export function normaliseFollowUp(raw: unknown): FollowUpBody {
  const r = FollowUpBodySchema.safeParse(raw);
  if (!r.success || !r.data.text.trim()) throw new ModelOutputError('follow-up schema');
  return r.data;
}

export function normaliseConcept(raw: unknown): ConceptBody {
  const r = ConceptBodySchema.safeParse(raw);
  if (!r.success || !r.data.plain.trim()) throw new ModelOutputError('concept schema');
  const spot = r.data.spotIt && r.data.spotIt.question.trim() ? r.data.spotIt : undefined;
  return { ...r.data, ...(spot ? { spotIt: spot } : { spotIt: undefined }) };
}

export function normaliseCheck(raw: unknown): CheckBody {
  const r = CheckBodySchema.safeParse(raw);
  if (!r.success || !r.data.options || r.data.correctIndex === undefined)
    throw new ModelOutputError('check schema');
  if (!r.data.question.trim() || r.data.options.some((o) => !o.trim()))
    throw new ModelOutputError('check content');
  return r.data;
}

export const OverviewOutputSchema = z.object({
  summary: z.string(),
  modules: z.array(z.object({ name: z.string(), paths: z.array(z.string()) })).default([]),
  refs: z.array(RefSchema).default([]),
});
