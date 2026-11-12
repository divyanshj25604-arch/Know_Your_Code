import type { Overview } from '@kyc/contracts';
import { ModelOutputError } from '../schemas';
import { lineClaim, type Capability } from '../capability';
import { OVERVIEW_TASK, SYSTEM_RULES_VERSION } from '../prompts';
import { OVERVIEW_JSON_SCHEMA, OverviewOutputSchema } from '../schemas';

export interface SummaryInput {
  /** Every stored path: modules and references must name real files. */
  paths: string[];
}

type Summary = Required<Pick<Overview['summary'], 'text' | 'refs' | 'modules'>>;

/** Project overview from facts, file headers and the README (its own context, not a retrieval plan). */
export const summariseProject: Capability<SummaryInput, Summary> = {
  id: 'summarise_project',
  version: `summarise_project@2+${SYSTEM_RULES_VERSION}`,
  task: 'overview',
  tier: 'strong',
  maxTokens: 900,
  intent: null,
  budget: 0,
  schema: OVERVIEW_JSON_SCHEMA as unknown as Record<string, unknown>,
  prompt: () => ({ task: OVERVIEW_TASK, input: {} }),
  normalise: (raw) => {
    const r = OverviewOutputSchema.safeParse(raw);
    if (!r.success || !r.data.summary.trim()) throw new ModelOutputError('overview schema');
    return { text: r.data.summary, refs: r.data.refs, modules: r.data.modules };
  },
  finalise(payload, _pack, i, stats) {
    const pathSet = new Set(i.paths);
    const words = payload.text.trim().split(/\s+/);
    const text = words.length > 220 ? `${words.slice(0, 220).join(' ')}…` : payload.text.trim();
    // Links must point at real files.
    const refs = payload.refs.filter((r) => {
      stats.total++;
      const ok = pathSet.has(r.path) && r.line >= 1;
      if (!ok) stats.stripped++;
      return ok;
    });
    const modules = payload.modules
      .map((m) => ({ name: m.name, paths: m.paths.filter((p) => pathSet.has(p)) }))
      .filter((m) => m.name.trim() && m.paths.length)
      .slice(0, 8);
    return {
      payload: { text, refs: refs.slice(0, 8), modules },
      claims: [lineClaim(text, refs.slice(0, 8))],
    };
  },
};
