import type { Depth, ExplanationBody, Selection, SelectionKind } from '@kyc/contracts';
import { edgeClaims, verifyLines, verifyRefs, type ContextPack, type VerifyStats } from '@kyc/core';
import { lineClaim, plainText, type Capability } from '../capability';
import { SYSTEM_RULES_VERSION, explainTask } from '../prompts';
import { EXPLANATION_JSON_SCHEMA, normaliseExplanation } from '../schemas';

export interface ExplainInput {
  kind: SelectionKind;
  depth: Depth;
  selection: Selection;
  enclosingSymbol: string | null;
  note: string | null;
}

function verifyBody(body: ExplanationBody, pack: ContextPack, stats: VerifyStats): ExplanationBody {
  const s = body.sections;
  const path = [...pack.ranges.keys()][0] ?? null;
  const v = (x: { text: string; refs: { path: string; line: number }[] }) => ({
    ...x,
    refs: verifyRefs(x.refs, pack.ranges, stats),
  });
  return {
    ...body,
    sections: {
      what: v(s.what),
      ...(s.why ? { why: v(s.why) } : {}),
      ...(s.steps
        ? { steps: s.steps.map((st) => ({ ...st, lines: verifyLines(st.lines, path, pack.ranges, stats) })) }
        : {}),
      ...(s.inputs ? { inputs: v(s.inputs) } : {}),
      ...(s.dependsOn ? { dependsOn: s.dependsOn } : {}),
      ...(s.effects ? { effects: v(s.effects) } : {}),
      ...(s.edgeCases ? { edgeCases: s.edgeCases.map(v) } : {}),
    },
  };
}

export const explainSelection: Capability<ExplainInput, ExplanationBody> = {
  id: 'explain_selection',
  version: `explain_selection@2+${SYSTEM_RULES_VERSION}`,
  task: 'explain',
  tier: 'fast',
  maxTokens: 1400,
  intent: 'explain',
  budget: 6000,
  schema: EXPLANATION_JSON_SCHEMA as unknown as Record<string, unknown>,
  prompt: (i) => ({
    task: explainTask(i.kind, i.depth),
    input: {
      kind: i.kind,
      depth: i.depth,
      selection: { path: i.selection.path, startLine: i.selection.startLine, endLine: i.selection.endLine },
      enclosingSymbol: i.enclosingSymbol,
      note: i.note,
    },
  }),
  normalise: (raw, i) => normaliseExplanation(raw, i.kind),
  fallback: (text, i) => {
    const t = plainText(text);
    return t
      ? {
          kind: i.kind,
          sections: { what: { text: t, refs: [] } },
          concepts: [],
          exploreNext: [],
          uncertainty: [
            { text: "The model's reply wasn't in the expected format, so only its plain text is shown." },
          ],
        }
      : null;
  },
  finalise(payload, pack, _i, stats) {
    if (!pack) return { payload, claims: [] };
    const body = verifyBody(payload, pack, stats);
    const s = body.sections;
    const claims = [
      lineClaim(s.what.text, s.what.refs),
      ...(s.why ? [lineClaim(s.why.text, s.why.refs)] : []),
      ...(s.inputs ? [lineClaim(s.inputs.text, s.inputs.refs)] : []),
      ...(s.effects ? [lineClaim(s.effects.text, s.effects.refs)] : []),
      ...(s.edgeCases ?? []).map((e) => lineClaim(e.text, e.refs)),
      ...edgeClaims(pack.edges),
    ];
    return { payload: body, claims };
  },
};
