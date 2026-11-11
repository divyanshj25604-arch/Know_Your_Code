import type { CapabilityId } from '@kyc/contracts';
import type { Capability } from './capability';
import { assess } from './capabilities/assess';
import { explainFlow } from './capabilities/explainFlow';
import { explainSelection } from './capabilities/explainSelection';
import { followUp } from './capabilities/followUp';
import { grade } from './capabilities/grade';
import { summariseProject } from './capabilities/summariseProject';
import { teachConcept } from './capabilities/teachConcept';

/** The AI capability registry (P2.3). Adding a capability = one module here plus a route or caller. */
export const CAPABILITIES = {
  explain_selection: explainSelection,
  explain_flow: explainFlow,
  teach_concept: teachConcept,
  follow_up: followUp,
  assess,
  grade,
  summarise_project: summariseProject,
} as const satisfies Record<CapabilityId, Capability<never, unknown>>;
