import type {
  ArchitectureView,
  ConceptIndex,
  FlowDetail,
  LearningLevel,
  LessonBlock,
  PathItemView,
} from '@kyc/contracts';

/**
 * Learning paths (P3.7): a curriculum generated deterministically from what the analysis found in one snapshot
 * (architecture map, concept index, request flows). Each path has a lesson, a mission (find something in the real
 * code) and a knowledge check. Missions and checks are answered from the code graph, so they are graded exactly on
 * the server; their answers never leave it. No AI is involved.
 *
 * Item ids are built from durable names (module keys, route names, concept ids), so progress recorded against a
 * repository still matches when a new snapshot of the same code is analysed.
 */

export interface PathFunction {
  key: string;
  name: string;
  path: string;
  startLine: number;
  endLine: number;
  tags: string[];
}

export interface PathInputs {
  architecture: ArchitectureView;
  concepts: ConceptIndex;
  flows: FlowDetail[];
  functions: PathFunction[];
}

interface Range {
  path: string;
  startLine: number;
  endLine: number;
}

export interface LessonContent {
  kind: 'lesson';
  id: string;
  title: string;
  blocks: LessonBlock[];
}

export interface MissionContent {
  kind: 'mission';
  id: string;
  title: string;
  goal: string;
  hint: string;
  /** Places that complete the mission (whole function ranges, or whole files). */
  accept: Range[];
  /** Where one answer is, shown once the mission is done. */
  answer: { path: string; line: number };
}

export interface CheckContent {
  kind: 'check';
  id: string;
  title: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  refs: { path: string; line: number }[];
}

export type PathItemContent = LessonContent | MissionContent | CheckContent;

export interface LearningPathContent {
  id: string;
  level: LearningLevel;
  title: string;
  summary: string;
  items: PathItemContent[];
}

const WHOLE_FILE = 1_000_000;
const MAX_DISTRACTORS = 3;

/** What a few common concepts are, in one plain sentence (fallback: none, the examples speak for themselves). */
const CONCEPT_NOTE: Record<string, string> = {
  'async-await':
    'An async function can pause at each await until a promise settles, so asynchronous steps read top to bottom.',
  promises: 'A promise stands for a value that will be ready later; then and catch run when it settles.',
  callbacks: 'A callback is a function passed to another function, which calls it later.',
  closures: 'A closure is a function that keeps using variables from the scope it was created in.',
  destructuring: 'Destructuring takes values out of an object or array into separate variables in one step.',
  'arrow-functions':
    'Arrow functions are a short function syntax; they keep `this` from the surrounding code.',
  'try-catch': 'try/catch runs code and handles an error thrown inside it instead of letting it escape.',
  'error-handling': 'Error handling decides what happens when something goes wrong, instead of crashing.',
  'http-request-response': 'A handler receives the request (req) and sends back the response (res).',
  'express-middleware':
    'Express middleware runs before a route handler and calls next() to pass the request on.',
  'array-methods': 'Array methods such as map, filter and reduce transform lists without writing loops.',
  'react-state': 'React state is data a component remembers between renders; changing it re-renders.',
  jsx: 'JSX describes the user interface as HTML-like markup inside JavaScript.',
};

/** A deterministic position for the correct option, so it is not always first. */
function slot(id: string, n: number): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % n;
}

function choice(
  id: string,
  correct: string,
  distractors: string[],
): { options: string[]; correctIndex: number } | null {
  const ds = [...new Set(distractors.filter((d) => d !== correct))].slice(0, MAX_DISTRACTORS);
  if (ds.length === 0) return null;
  const at = slot(id, ds.length + 1);
  const options = [...ds];
  options.splice(at, 0, correct);
  return { options, correctIndex: at };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Which module imports from which, strongest first, from the verified import edges. */
function dependencyBlocks(a: ArchitectureView, nameOf: Map<string, string>): LessonBlock[] {
  if (a.dependencies.length === 0)
    return [{ type: 'text', text: 'No module imports from another one: each part stands on its own.' }];
  const deps = [...a.dependencies].sort((x, y) => y.imports - x.imports || (x.from < y.from ? -1 : 1));
  return [
    {
      type: 'text',
      text: 'A module depends on another when its files import from it. Reading a codebase in that order, from the modules nothing depends on down to the ones everything uses, follows how a request travels.',
    },
    ...deps.slice(0, 12).map((d): LessonBlock => ({
      type: 'text',
      text: `${nameOf.get(d.from) ?? d.from} imports from ${nameOf.get(d.to) ?? d.to} (${plural(d.imports, 'import')}).`,
    })),
  ];
}

function projectPath(i: PathInputs): LearningPathContent | null {
  const a = i.architecture;
  if (!a.available || a.modules.length < 2) return null;
  const nameOf = new Map(a.modules.map((m) => [m.key, m.name]));
  const shown = a.modules.slice(0, 8);
  const blocks: LessonBlock[] = [
    {
      type: 'text',
      text: `This repository is organised into ${plural(a.modules.length, a.monorepo ? 'package' : 'module')}. Each one groups related files; the arrows between them are real imports.`,
    },
  ];
  for (const m of shown) {
    const uses = a.dependencies.filter((d) => d.from === m.key).map((d) => nameOf.get(d.to) ?? d.to);
    blocks.push({
      type: 'text',
      text: `${m.name}: ${plural(m.files.length, 'file')}${uses.length ? `; uses ${uses.join(', ')}` : '; uses no other module'}.`,
    });
    if (m.files[0]) blocks.push({ type: 'code', path: m.files[0], line: 1, label: `Open ${m.files[0]}` });
  }
  // Mission: open a file of the module the most other modules depend on.
  const used = [...a.modules].sort(
    (x, y) =>
      a.dependencies.filter((d) => d.to === y.key).length -
        a.dependencies.filter((d) => d.to === x.key).length || (x.key < y.key ? -1 : 1),
  )[0]!;
  const mission: MissionContent = {
    kind: 'mission',
    id: `mission:module-file:${used.key}`,
    title: `Find the ${used.name} module`,
    goal: `Open any file that belongs to the ${used.name} module, then mark it.`,
    hint: used.root ? `Its files are under ${used.root}/.` : 'Look at the top level of the file tree.',
    accept: used.files.map((path) => ({ path, startLine: 1, endLine: WHOLE_FILE })),
    answer: { path: used.files[0]!, line: 1 },
  };
  // Check: what one module uses (from verified import edges), or which file belongs to a module.
  let check: CheckContent | null = null;
  const dep = [...a.dependencies].sort((x, y) => y.imports - x.imports || (x.from < y.from ? -1 : 1))[0];
  if (dep) {
    const from = nameOf.get(dep.from) ?? dep.from;
    const id = `check:module-uses:${dep.from}->${dep.to}`;
    const usedByFrom = new Set(a.dependencies.filter((d) => d.from === dep.from).map((d) => d.to));
    const c = choice(
      id,
      nameOf.get(dep.to) ?? dep.to,
      a.modules.filter((m) => m.key !== dep.from && !usedByFrom.has(m.key)).map((m) => m.name),
    );
    if (c)
      check = {
        kind: 'check',
        id,
        title: `What ${from} depends on`,
        question: `Which module does ${from} import from?`,
        ...c,
        explanation: `${from} imports from ${nameOf.get(dep.to) ?? dep.to} (${plural(dep.imports, 'import')}).`,
        refs: [],
      };
  }
  if (!check) {
    const m = shown[0]!;
    const id = `check:module-file:${m.key}`;
    const c = choice(
      id,
      m.files[0] ?? '',
      a.modules.filter((x) => x.key !== m.key).flatMap((x) => x.files.slice(0, 1)),
    );
    if (c && m.files[0])
      check = {
        kind: 'check',
        id,
        title: `Files of ${m.name}`,
        question: `Which of these files belongs to the ${m.name} module?`,
        ...c,
        explanation: `${m.files[0]} is in ${m.name}.`,
        refs: [{ path: m.files[0], line: 1 }],
      };
  }
  if (!check) return null;
  return {
    id: 'path:project',
    level: 'project',
    title: 'How this project is organised',
    summary: 'Learn the modules of the codebase and how they depend on each other.',
    items: [
      { kind: 'lesson', id: 'lesson:modules', title: 'The modules', blocks },
      {
        kind: 'lesson',
        id: 'lesson:module-dependencies',
        title: 'How the modules depend on each other',
        blocks: dependencyBlocks(a, nameOf),
      },
      mission,
      check,
    ],
  };
}

function applicationPath(i: PathInputs): LearningPathContent | null {
  const fnByKey = new Map(i.functions.map((f) => [f.key, f]));
  const candidates = i.flows
    .map((f) => ({
      f,
      handler: f.steps.find((s) => s.kind === 'handler' && s.symbolKey && fnByKey.has(s.symbolKey)),
      calls: f.steps.filter((s) => s.kind === 'call' && s.provenance === 'verified' && s.depth === 1),
    }))
    .filter((c) => c.handler && c.calls.length > 0)
    .sort((x, y) => y.calls.length - x.calls.length || (x.f.name < y.f.name ? -1 : 1));
  const best = candidates[0];
  if (!best) return null;
  const { f, calls } = best;
  const handler = fnByKey.get(best.handler!.symbolKey!)!;
  const route = f.steps.find((s) => s.kind === 'route');
  const mission: MissionContent = {
    kind: 'mission',
    id: `mission:handler:${f.name}`,
    title: `Find the handler of ${f.name}`,
    goal: `Find the function that runs when a request for ${f.name} arrives, open it, then mark it.`,
    hint: route?.path
      ? `Routes are registered in ${route.path}; follow the name passed to the route.`
      : 'Start from where the routes are registered.',
    accept: [{ path: handler.path, startLine: handler.startLine, endLine: handler.endLine }],
    answer: { path: handler.path, line: handler.startLine },
  };
  const handlerAt = f.steps.findIndex((s) => s.kind === 'handler');
  const describe = (s: FlowDetail['steps'][number], n: number): LessonBlock[] => {
    const what =
      s.kind === 'unknown'
        ? `Not followed: ${s.label}${s.reason ? ` (${s.reason})` : ''}.`
        : `${s.kind === 'call' ? 'Calls' : s.kind[0]!.toUpperCase() + s.kind.slice(1)}: ${s.label}.`;
    return [
      { type: 'text', text: `${n + 1}. ${what}` },
      ...(s.path && s.line && s.kind !== 'unknown'
        ? [{ type: 'code' as const, path: s.path, line: s.line, label: `Open ${s.label}` }]
        : []),
    ];
  };
  const reach: LessonBlock[] = [
    {
      type: 'text',
      text: `This is how a ${f.method} request to ${f.routePath ?? 'this route'} reaches its handler, found by static analysis (nothing was run). Middleware runs in the order it was registered.`,
    },
    ...f.steps.slice(0, handlerAt).flatMap(describe),
  ];
  const blocks: LessonBlock[] = [
    {
      type: 'text',
      text: `What ${handler.name} does once the request arrives. Calls marked verified are real calls in the code; steps marked "not followed" could not be traced and say why.`,
    },
    ...f.steps.slice(handlerAt).flatMap((s, n) => describe(s, n + handlerAt)),
  ];
  const first = calls[0]!;
  const directly = new Set(calls.map((c) => c.symbolKey));
  const id = `check:flow-call:${f.name}`;
  const c = choice(
    id,
    first.label,
    i.functions
      .filter((x) => x.key !== handler.key && !directly.has(x.key) && !/[ %]/.test(x.name))
      .sort(byName)
      .map((x) => x.name),
  );
  if (!c) return null;
  return {
    id: 'path:application',
    level: 'application',
    title: `Follow a request: ${f.name}`,
    summary: 'Trace one request through the application, from the route to the code it calls.',
    items: [
      mission,
      {
        kind: 'lesson',
        id: `lesson:flow-route:${f.name}`,
        title: `How ${f.name} reaches its handler`,
        blocks: reach,
      },
      { kind: 'lesson', id: `lesson:flow:${f.name}`, title: `What ${handler.name} does`, blocks },
      {
        kind: 'check',
        id,
        title: 'What the handler calls',
        question: `While handling ${f.name}, which function does ${handler.name} call?`,
        ...c,
        explanation: `${handler.name} calls ${first.label} (a verified call in the code).`,
        refs: first.path && first.line ? [{ path: first.path, line: first.line }] : [],
      },
    ],
  };
}

function conceptPath(i: PathInputs): LearningPathContent | null {
  const concept = i.concepts.concepts.find((c) => c.files >= 2);
  if (!concept) return null;
  const tag = `concept:${concept.id}`;
  const shown = concept.examples[0]!;
  const others = i.functions.filter((f) => f.tags.includes(tag) && f.path !== shown.path);
  if (others.length === 0) return null;
  const blocks: LessonBlock[] = [
    {
      type: 'text',
      text: `This code uses ${concept.label} in ${plural(concept.count, 'place')} across ${plural(concept.files, 'file')}.`,
    },
    ...(CONCEPT_NOTE[concept.id] ? [{ type: 'text' as const, text: CONCEPT_NOTE[concept.id]! }] : []),
    { type: 'text', text: `Here is one example, ${shown.name}:` },
    { type: 'code', path: shown.path, line: shown.line, label: `Open ${shown.name}` },
  ];
  const mission: MissionContent = {
    kind: 'mission',
    id: `mission:concept:${concept.id}`,
    title: `Spot ${concept.label} yourself`,
    goal: `Find another function that uses ${concept.label}, in a different file from ${shown.path}, open it, then mark it.`,
    hint: `${plural(concept.files - 1, 'other file')} ${concept.files - 1 === 1 ? 'has' : 'have'} one.`,
    accept: others.map((f) => ({ path: f.path, startLine: f.startLine, endLine: f.endLine })),
    answer: { path: others[0]!.path, line: others[0]!.startLine },
  };
  const target = [...others].sort(byName)[0]!;
  const id = `check:concept:${concept.id}`;
  const c = choice(
    id,
    target.name,
    i.functions
      .filter((f) => !f.tags.includes(tag) && !/[ %]/.test(f.name))
      .sort(byName)
      .map((f) => f.name),
  );
  if (!c) return null;
  return {
    id: 'path:concepts',
    level: 'concept',
    title: `Concepts: ${concept.label}`,
    summary: `Learn ${concept.label} from real examples in this codebase.`,
    items: [
      { kind: 'lesson', id: `lesson:concept:${concept.id}`, title: `${concept.label} in this code`, blocks },
      mission,
      {
        kind: 'check',
        id,
        title: `Recognise ${concept.label}`,
        question: `Which of these functions uses ${concept.label}?`,
        ...c,
        explanation: `${target.name} uses ${concept.label}.`,
        refs: [{ path: target.path, line: target.startLine }],
      },
      {
        kind: 'lesson',
        id: `lesson:concept-review:${concept.id}`,
        title: `Review: everywhere ${concept.label} appears`,
        blocks: [
          {
            type: 'text',
            text: `These are the functions in this code that use ${concept.label}. Compare how each one uses it.`,
          },
          ...i.functions
            .filter((f) => f.tags.includes(tag))
            .slice(0, 12)
            .map((f): LessonBlock => ({
              type: 'code',
              path: f.path,
              line: f.startLine,
              label: `Open ${f.name}`,
            })),
        ],
      },
    ],
  };
}

/** Every path the snapshot supports, in learning order (project, application, concepts). */
export function buildLearningPaths(i: PathInputs): LearningPathContent[] {
  return [projectPath(i), applicationPath(i), conceptPath(i)].filter(
    (p): p is LearningPathContent => p !== null,
  );
}

/** Whether a place in the code completes a mission. */
export function missionMet(m: MissionContent, at: { path: string; line: number }): boolean {
  return m.accept.some((r) => r.path === at.path && at.line >= r.startLine && at.line <= r.endLine);
}

/** The learner's view of an item: everything except answers. */
export function itemView(item: PathItemContent, status: PathItemView['status']): PathItemView {
  const base = { id: item.id, kind: item.kind, title: item.title, status };
  if (item.kind === 'lesson') return { ...base, blocks: item.blocks };
  if (item.kind === 'mission') return { ...base, goal: item.goal, hint: item.hint };
  return { ...base, question: item.question, options: item.options };
}
