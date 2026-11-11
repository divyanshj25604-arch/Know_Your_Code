import type { ConceptBody, ExplanationBody, FollowUpBody, Selection } from '@kyc/contracts';
import { api, type StoredExplanation } from '../api/client';
import { newExpl, type ExplState, type Section, type ThreadItem } from '../lib/expl';
import { queries } from './queryCache';

/**
 * Explanation store (P2.1): explanations by server id, restorable after a reload with GET /explanations/:id. A trail
 * stop records only the id; the full explanation and its thread are rebuilt from the server when it is shown.
 */
export function sectionsOf(body: ExplanationBody): Section[] {
  const s = body.sections;
  const out: Section[] = [{ name: 'what', ...s.what }];
  if (s.why) out.push({ name: 'why', ...s.why });
  if (s.steps) out.push({ name: 'steps', steps: s.steps });
  if (s.inputs) out.push({ name: 'inputs', ...s.inputs });
  if (s.dependsOn) out.push({ name: 'dependsOn', ...s.dependsOn });
  if (s.effects) out.push({ name: 'effects', ...s.effects });
  if (s.edgeCases) out.push({ name: 'edgeCases', items: s.edgeCases });
  return out;
}

function threadOf(messages: StoredExplanation['messages']): ThreadItem[] {
  return messages.map((m): ThreadItem => {
    if (m.role === 'user')
      return { id: m.id, kind: 'question', text: String((m.body as { text?: string }).text ?? '') };
    if (m.intent === 'concept') {
      const c = m.body as unknown as ConceptBody;
      return {
        id: m.id,
        kind: 'concept',
        messageId: m.id,
        concept: c.concept,
        plain: c.plain,
        term: c.term,
        inYourCode: c.inYourCode,
        ...(c.spotIt ? { spotIt: c.spotIt } : {}),
        backToCode: c.backToCode,
      };
    }
    const f = m.body as unknown as FollowUpBody;
    return {
      id: m.id,
      kind: 'answer',
      messageId: m.id,
      text: f.text,
      refs: f.refs,
      uncertainty: f.uncertainty,
    };
  });
}

/** Rebuild the panel state of a stored explanation. */
export function explStateOf(stored: StoredExplanation, label: string): ExplState {
  const body = stored.body;
  return {
    ...newExpl(stored.selection as Selection, label),
    status: 'done',
    meta: {
      explanationId: stored.id,
      kind: stored.kind,
      cached: true,
      depth: stored.depth,
      note: null,
      spansMultiple: false,
      parentId: stored.parentId,
    },
    sections: sectionsOf(body),
    done: {
      concepts: body.concepts,
      exploreNext: body.exploreNext,
      tryIt: body.tryIt ?? null,
      uncertainty: body.uncertainty,
      refsStripped: stored.refsStripped,
    },
    thread: threadOf(stored.messages),
    visitedConcepts: stored.messages.flatMap((m) =>
      m.intent === 'concept' && m.role === 'assistant'
        ? [String((m.body as { concept?: string }).concept)]
        : [],
    ),
  };
}

export const loadExplanation = (id: string): Promise<StoredExplanation> =>
  queries.get(`explanation:${id}`, () => api.explanation(id));
