import { describe, expect, it } from 'vitest';
import type { ArchitectureView, ConceptIndex, FlowDetail } from '@kyc/contracts';
import { buildLearningPaths, itemView, missionMet, type MissionContent, type PathInputs } from '../src';

const architecture: ArchitectureView = {
  available: true,
  monorepo: false,
  modules: [
    {
      key: 'dir:src/controllers',
      name: 'controllers',
      kind: 'directory',
      root: 'src/controllers',
      files: ['src/controllers/auth.js'],
    },
    {
      key: 'dir:src/models',
      name: 'models',
      kind: 'directory',
      root: 'src/models',
      files: ['src/models/user.js'],
    },
    {
      key: 'dir:src/services',
      name: 'services',
      kind: 'directory',
      root: 'src/services',
      files: ['src/services/user.js'],
    },
  ],
  dependencies: [
    { from: 'dir:src/controllers', to: 'dir:src/services', imports: 1 },
    { from: 'dir:src/services', to: 'dir:src/models', imports: 1 },
  ],
};
const fn = (
  key: string,
  name: string,
  path: string,
  startLine: number,
  endLine: number,
  tags: string[] = [],
) => ({
  key,
  name,
  path,
  startLine,
  endLine,
  tags,
});
const functions = [
  fn('k:login', 'login', 'src/controllers/auth.js', 3, 7, ['concept:async-await']),
  fn('k:find', 'findUser', 'src/services/user.js', 7, 9, ['concept:async-await']),
  fn('k:norm', 'normalise', 'src/services/user.js', 3, 5),
  fn('k:cb', 'GET /health', 'src/app.js', 8, 10),
];
const concepts: ConceptIndex = {
  concepts: [
    {
      id: 'async-await',
      label: 'async await',
      count: 2,
      files: 2,
      examples: [
        { symbolId: 's1', symbolKey: 'k:login', name: 'login', path: 'src/controllers/auth.js', line: 3 },
        { symbolId: 's2', symbolKey: 'k:find', name: 'findUser', path: 'src/services/user.js', line: 7 },
      ],
    },
  ],
};
const step = (index: number, kind: FlowDetail['steps'][number]['kind'], label: string, extra = {}) => ({
  index,
  kind,
  label,
  path: null,
  line: null,
  symbolId: null,
  symbolKey: null,
  provenance: 'pattern' as const,
  depth: 0,
  reason: null,
  edgeId: null,
  ...extra,
});
const flow: FlowDetail = {
  id: 'f1',
  snapshotId: 's',
  name: 'POST /auth/login',
  method: 'POST',
  routePath: '/auth/login',
  clients: 0,
  stepCount: 4,
  unknownCount: 1,
  handler: null,
  steps: [
    step(0, 'route', 'POST /auth/login', { path: 'src/routes/auth.js', line: 4 }),
    step(1, 'handler', 'login', { path: 'src/controllers/auth.js', line: 3, symbolKey: 'k:login' }),
    step(2, 'call', 'findUser', {
      path: 'src/services/user.js',
      line: 7,
      symbolKey: 'k:find',
      provenance: 'verified',
      depth: 1,
      edgeId: '9',
    }),
    step(3, 'unknown', 'User.findOne', { provenance: 'unknown', depth: 2, reason: 'not analysed' }),
  ],
};
const inputs: PathInputs = { architecture, concepts, flows: [flow], functions };

describe('learning paths (P3.7)', () => {
  it('builds project, application and concept paths, each with a lesson, a mission and a check', () => {
    const paths = buildLearningPaths(inputs);
    expect(paths.map((p) => p.id)).toEqual(['path:project', 'path:application', 'path:concepts']);
    for (const p of paths) expect(p.items.map((i) => i.kind).sort()).toEqual(['check', 'lesson', 'mission']);
    const project = paths[0]!;
    const check = project.items.find((i) => i.kind === 'check')!;
    if (check.kind !== 'check') throw new Error();
    expect(check.question).toBe('Which module does controllers import from?');
    expect(check.options[check.correctIndex]).toBe('services');
    expect(check.options).not.toContain('controllers');
    const app = paths[1]!;
    const appCheck = app.items.find((i) => i.kind === 'check')!;
    if (appCheck.kind !== 'check') throw new Error();
    expect(appCheck.options[appCheck.correctIndex]).toBe('findUser');
    // Directly called functions, the handler itself and callbacks are never distractors.
    expect(appCheck.options).toEqual(expect.arrayContaining(['normalise']));
    expect(appCheck.options).not.toContain('login');
    expect(appCheck.options).not.toContain('GET /health');
    const lesson = app.items.find((i) => i.kind === 'lesson')!;
    if (lesson.kind !== 'lesson') throw new Error();
    expect(lesson.blocks).toContainEqual({
      type: 'text',
      text: '4. Not followed: User.findOne (not analysed).',
    });
  });

  it('is deterministic, and leaves out paths the analysis cannot support', () => {
    expect(JSON.stringify(buildLearningPaths(inputs))).toBe(JSON.stringify(buildLearningPaths(inputs)));
    const none = buildLearningPaths({
      architecture: { available: false, monorepo: false, modules: [], dependencies: [] },
      concepts: { concepts: [] },
      flows: [],
      functions,
    });
    expect(none).toEqual([]);
    // A concept seen in one file cannot ask for "another file".
    const one = buildLearningPaths({
      ...inputs,
      concepts: { concepts: [{ ...concepts.concepts[0]!, files: 1 }] },
    });
    expect(one.map((p) => p.id)).not.toContain('path:concepts');
  });

  it('grades missions by real code ranges and never exposes answers', () => {
    const paths = buildLearningPaths(inputs);
    const m = paths[1]!.items.find((i) => i.kind === 'mission') as MissionContent;
    expect(missionMet(m, { path: 'src/controllers/auth.js', line: 3 })).toBe(true);
    expect(missionMet(m, { path: 'src/controllers/auth.js', line: 7 })).toBe(true);
    expect(missionMet(m, { path: 'src/controllers/auth.js', line: 8 })).toBe(false);
    expect(missionMet(m, { path: 'src/services/user.js', line: 7 })).toBe(false);
    const cm = paths[2]!.items.find((i) => i.kind === 'mission') as MissionContent;
    expect(missionMet(cm, { path: 'src/services/user.js', line: 8 })).toBe(true);
    expect(missionMet(cm, { path: 'src/controllers/auth.js', line: 4 })).toBe(false); // the lesson's own example
    for (const p of paths)
      for (const i of p.items) {
        const v = JSON.stringify(itemView(i, 'not_started'));
        expect(v).not.toMatch(/correctIndex|accept|answer|explanation/);
      }
  });
});
