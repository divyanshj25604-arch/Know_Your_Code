import { z } from 'zod';

export const SelectionSchema = z
  .object({
    path: z.string().min(1).max(1024),
    startLine: z.number().int().min(1),
    startCol: z.number().int().min(0),
    endLine: z.number().int().min(1),
    endCol: z.number().int().min(0),
  })
  .refine((s) => s.endLine > s.startLine || (s.endLine === s.startLine && s.endCol >= s.startCol), {
    message: 'selection end precedes start',
  });
export type Selection = z.infer<typeof SelectionSchema>;

export const DepthSchema = z.enum(['simpler', 'default', 'deeper']);
export type Depth = z.infer<typeof DepthSchema>;

export type Provenance = 'verified' | 'pattern' | 'explained';

export const ImportRequestSchema = z.object({
  url: z.string().min(1).max(300),
  ref: z.string().max(200).regex(/^\S+$/, 'ref must not contain whitespace').optional(),
});
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

export const ResolveRequestSchema = z.object({ selection: SelectionSchema });

export const ExplainRequestSchema = z.object({
  snapshotId: z.string().uuid(),
  selection: SelectionSchema,
  depth: DepthSchema.default('default'),
});
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;

export const MessageRequestSchema = z
  .object({
    intent: z.enum(['followup', 'simpler', 'deeper', 'concept']),
    text: z.string().min(1).max(1000).optional(),
    conceptId: z.string().min(1).max(80).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.intent === 'followup' && !v.text)
      ctx.addIssue({ code: 'custom', message: 'text required for followup' });
    if (v.intent === 'concept' && !v.conceptId)
      ctx.addIssue({ code: 'custom', message: 'conceptId required for concept' });
  });
export type MessageRequest = z.infer<typeof MessageRequestSchema>;

export const FeedbackRequestSchema = z.object({
  targetType: z.enum(['explanation', 'message', 'check']),
  targetId: z.string().uuid(),
  rating: z.enum(['up', 'down']),
  reason: z.enum(['incorrect', 'too_complex', 'too_basic', 'not_what_i_asked', 'other']).optional(),
  comment: z.string().max(500).optional(),
});

export const EVENT_NAMES = [
  'landing_cta',
  'import_submitted',
  'explanation_requested',
  'explanation_complete',
  'relation_clicked',
  'followup_asked',
  'concept_opened',
  'check_started',
  'repo_deleted',
] as const;
export const EventsRequestSchema = z.object({
  events: z
    .array(
      z.object({
        name: z.enum(EVENT_NAMES),
        ts: z.string().optional(),
        props: z.record(z.union([z.string().max(100), z.number(), z.boolean()])).default({}),
      }),
    )
    .max(50),
});

export const CheckAnswerRequestSchema = z.object({
  answerIndex: z.number().int().min(0).max(3).optional(),
  text: z.string().min(1).max(2000).optional(),
});

/** Refs the AI may attach to a statement. Verified server-side before display (docs/09 §10). */
export const RefSchema = z.object({ path: z.string(), line: z.number().int().min(1) });
export type Ref = z.infer<typeof RefSchema>;

const TextWithRefs = z.object({ text: z.string(), refs: z.array(RefSchema).default([]) });

export const ExplanationBodySchema = z.object({
  kind: z.string(),
  sections: z.object({
    what: TextWithRefs,
    why: TextWithRefs.optional(),
    steps: z
      .array(z.object({ text: z.string(), lines: z.array(z.number().int()).max(2).default([]) }))
      .optional(),
    inputs: TextWithRefs.optional(),
    dependsOn: z.object({ text: z.string() }).optional(),
    effects: TextWithRefs.optional(),
    edgeCases: z.array(TextWithRefs).optional(),
  }),
  concepts: z.array(z.object({ id: z.string(), label: z.string() })).default([]),
  exploreNext: z.array(z.object({ type: z.literal('question'), text: z.string() })).default([]),
  tryIt: z.object({ type: z.enum(['predict', 'explain']), text: z.string() }).optional(),
  uncertainty: z.array(z.object({ text: z.string() })).default([]),
});
export type ExplanationBody = z.infer<typeof ExplanationBodySchema>;

export const FollowUpBodySchema = z.object({
  text: z.string(),
  refs: z.array(RefSchema).default([]),
  uncertainty: z.array(z.object({ text: z.string() })).default([]),
});
export type FollowUpBody = z.infer<typeof FollowUpBodySchema>;

export const ConceptBodySchema = z.object({
  concept: z.string(),
  plain: z.string(),
  term: z.string(),
  inYourCode: z
    .array(z.object({ path: z.string(), line: z.number().int().min(1), note: z.string() }))
    .default([]),
  spotIt: z.object({ question: z.string() }).optional(),
  backToCode: z.string(),
});
export type ConceptBody = z.infer<typeof ConceptBodySchema>;

export const CheckBodySchema = z.object({
  type: z.enum(['predict', 'trace', 'why']),
  question: z.string(),
  options: z.array(z.string()).length(4).optional(),
  correctIndex: z.number().int().min(0).max(3).optional(),
  answerRefs: z.array(RefSchema).default([]),
  explanation: z.string(),
});
export type CheckBody = z.infer<typeof CheckBodySchema>;

export const CONCEPT_VOCAB = [
  'async-await',
  'promises',
  'callbacks',
  'closures',
  'destructuring',
  'spread-rest',
  'arrow-functions',
  'higher-order-functions',
  'array-methods',
  'error-handling',
  'try-catch',
  'express-middleware',
  'express-routing',
  'http-request-response',
  'rest-api',
  'jwt',
  'authentication',
  'password-hashing',
  'orm-query',
  'sql',
  'mongoose',
  'prisma',
  'env-variables',
  'modules-imports',
  'commonjs-require',
  'react-component',
  'react-state',
  'react-props',
  'useEffect',
  'useCallback',
  'react-context',
  'jsx',
  'typescript-types',
  'interfaces',
  'generics',
  'classes',
  'inheritance',
  'this-binding',
  'event-loop',
  'json',
  'regex',
  'recursion',
  'null-undefined',
  'optional-chaining',
  'ternary',
  'validation',
  'dependency-injection',
  'singleton',
  'caching',
  'pagination',
  'cors',
  'streams',
  'testing',
] as const;
