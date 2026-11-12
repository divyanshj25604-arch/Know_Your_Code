import type { CapabilityId } from '@kyc/contracts';

/**
 * The fixed evaluation dataset (P4.3). Each case drives one AI capability through the real HTTP API on a fixture
 * repository and states, ahead of time, what a grounded answer must cite and say, and what it must not claim.
 *
 * Expectations are written from the fixture code only (packages/core/tests/fixtures), never from a model's output.
 * `mustCite` lists code a correct answer has to reference (any line in the range counts). `mustMention` lists terms
 * that only appear in a correct answer. `mustNotMention` lists plausible-sounding claims the code does NOT support
 * (hallucination probes). Comparisons are case-insensitive.
 */
export interface Cite {
  path: string;
  from: number;
  to: number;
}

export interface EvalCase {
  id: string;
  capability: CapabilityId;
  repo: 'acme/notes-api' | 'acme/shop';
  /** What to ask. */
  request:
    | { kind: 'summary' }
    | { kind: 'explain'; path: string; startLine: number; startCol: number; endLine: number; endCol: number }
    | {
        kind: 'flow';
        path: string;
        startLine: number;
        startCol: number;
        endLine: number;
        endCol: number;
        hops: number;
      }
    | { kind: 'concept'; conceptId: string }
    | { kind: 'followup'; on: EvalCase['request'] & { kind: 'explain' }; text: string }
    | { kind: 'assess'; on: EvalCase['request'] & { kind: 'explain' }; format: 'choice' | 'open' }
    | { kind: 'grade'; on: EvalCase['request'] & { kind: 'explain' }; answer: string };
  expect: {
    mustCite: Cite[];
    mustMention: string[];
    mustNotMention: string[];
  };
}

const LOGIN = {
  kind: 'explain' as const,
  path: 'src/controllers/authController.js',
  startLine: 3,
  startCol: 1,
  endLine: 7,
  endCol: 2,
};
const FIND_USER = {
  kind: 'explain' as const,
  path: 'src/services/userService.js',
  startLine: 7,
  startCol: 1,
  endLine: 9,
  endCol: 2,
};
const CART_TOTAL = {
  kind: 'explain' as const,
  path: 'src/components/Cart.tsx',
  startLine: 12,
  startCol: 3,
  endLine: 12,
  endCol: 70,
};

/** Claims a model might invent about these small fixtures: none of them is in the code. */
const NOTES_API_FICTION = ['bcrypt', 'jwt', 'jsonwebtoken', 'password hash', 'redis', 'session cookie'];
const SHOP_FICTION = ['redux', 'graphql', 'stripe', 'useReducer'];

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'explain-login',
    capability: 'explain_selection',
    repo: 'acme/notes-api',
    request: LOGIN,
    expect: {
      mustCite: [{ path: 'src/controllers/authController.js', from: 3, to: 7 }],
      mustMention: ['findUserByEmail', '401'],
      mustNotMention: NOTES_API_FICTION,
    },
  },
  {
    id: 'explain-find-user',
    capability: 'explain_selection',
    repo: 'acme/notes-api',
    request: FIND_USER,
    expect: {
      mustCite: [{ path: 'src/services/userService.js', from: 7, to: 9 }],
      mustMention: ['normalise', 'findOne'],
      mustNotMention: NOTES_API_FICTION,
    },
  },
  {
    id: 'explain-cart-total',
    capability: 'explain_selection',
    repo: 'acme/shop',
    request: CART_TOTAL,
    expect: {
      mustCite: [{ path: 'src/components/Cart.tsx', from: 12, to: 12 }],
      mustMention: ['reduce'],
      mustNotMention: SHOP_FICTION,
    },
  },
  {
    id: 'flow-login',
    capability: 'explain_flow',
    repo: 'acme/notes-api',
    request: { ...LOGIN, kind: 'flow', startLine: 4, startCol: 15, endLine: 4, endCol: 52, hops: 3 },
    expect: {
      mustCite: [{ path: 'src/controllers/authController.js', from: 3, to: 7 }],
      mustMention: ['findUserByEmail', 'normalise'],
      mustNotMention: NOTES_API_FICTION,
    },
  },
  {
    id: 'concept-async-await',
    capability: 'teach_concept',
    repo: 'acme/notes-api',
    request: { kind: 'concept', conceptId: 'async-await' },
    expect: {
      mustCite: [{ path: 'src/controllers/authController.js', from: 3, to: 7 }],
      mustMention: ['await'],
      mustNotMention: ['promise.all', ...NOTES_API_FICTION],
    },
  },
  {
    id: 'followup-login-401',
    capability: 'follow_up',
    repo: 'acme/notes-api',
    request: { kind: 'followup', on: LOGIN, text: 'What happens when no user matches the email?' },
    expect: {
      mustCite: [{ path: 'src/controllers/authController.js', from: 5, to: 5 }],
      mustMention: ['401'],
      mustNotMention: NOTES_API_FICTION,
    },
  },
  {
    id: 'assess-login-choice',
    capability: 'assess',
    repo: 'acme/notes-api',
    request: { kind: 'assess', on: LOGIN, format: 'choice' },
    expect: { mustCite: [], mustMention: [], mustNotMention: NOTES_API_FICTION },
  },
  {
    id: 'assess-find-user-open',
    capability: 'assess',
    repo: 'acme/notes-api',
    request: { kind: 'assess', on: FIND_USER, format: 'open' },
    expect: { mustCite: [], mustMention: [], mustNotMention: NOTES_API_FICTION },
  },
  {
    id: 'grade-login-answer',
    capability: 'grade',
    repo: 'acme/notes-api',
    request: {
      kind: 'grade',
      on: LOGIN,
      answer: 'login awaits findUserByEmail with the request email and answers 401 when no user is found.',
    },
    expect: { mustCite: [], mustMention: [], mustNotMention: NOTES_API_FICTION },
  },
  {
    id: 'summary-notes-api',
    capability: 'summarise_project',
    repo: 'acme/notes-api',
    request: { kind: 'summary' },
    expect: { mustCite: [], mustMention: ['express'], mustNotMention: ['react', 'graphql', 'bcrypt', 'jwt'] },
  },
  {
    id: 'summary-shop',
    capability: 'summarise_project',
    repo: 'acme/shop',
    request: { kind: 'summary' },
    expect: { mustCite: [], mustMention: ['react'], mustNotMention: ['express', 'graphql', 'redux'] },
  },
];
