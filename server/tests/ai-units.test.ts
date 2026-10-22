import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env';
import { costUsd } from '../src/ai/cost';
import { ModelOutputError, normaliseCheck, normaliseExplanation } from '../src/ai/schemas';
import { verifyLines, verifyRefs, type AllowedRanges } from '../src/ai/verify';

const ranges: AllowedRanges = new Map([
  ['a.js', [[3, 10]]],
  [
    'b.js',
    [
      [1, 2],
      [20, 25],
    ],
  ],
]);

describe('verifyRefs', () => {
  it('keeps refs inside shown ranges and strips everything else, counting both', () => {
    const stats = { total: 0, stripped: 0 };
    const out = verifyRefs(
      [
        { path: 'a.js', line: 3 },
        { path: 'a.js', line: 10 },
        { path: 'a.js', line: 11 }, // just outside
        { path: 'b.js', line: 21 },
        { path: 'b.js', line: 5 }, // gap between ranges
        { path: 'c.js', line: 1 }, // file never shown
        { path: 'a.js', line: 3 }, // duplicate
      ],
      ranges,
      stats,
    );
    expect(out).toEqual([
      { path: 'a.js', line: 3 },
      { path: 'a.js', line: 10 },
      { path: 'b.js', line: 21 },
    ]);
    expect(stats).toEqual({ total: 7, stripped: 3 });
  });
  it('handles undefined and filters step lines against the selection file', () => {
    const stats = { total: 0, stripped: 0 };
    expect(verifyRefs(undefined, ranges, stats)).toEqual([]);
    expect(verifyLines([3, 4, 99], 'a.js', ranges, stats)).toEqual([3, 4]);
    expect(verifyLines([3], null, ranges, stats)).toEqual([]);
  });
});

describe('normaliseExplanation', () => {
  const base = {
    what: { text: 'It logs in.', refs: [] },
    why: { text: '', refs: [] },
    steps: [],
    inputs: { text: '', refs: [] },
    dependsOn: { text: '' },
    effects: { text: '', refs: [] },
    edgeCases: [],
    concepts: [],
    exploreNext: [],
    tryIt: { type: 'predict', text: '' },
    uncertainty: [],
  };
  it('drops empty sections so the UI only renders what exists', () => {
    const b = normaliseExplanation(base, 'function');
    expect(Object.keys(b.sections)).toEqual(['what']);
    expect(b.tryIt).toBeUndefined();
  });
  it('maps unknown concept ids to other:<label> and caps lists', () => {
    const b = normaliseExplanation(
      {
        ...base,
        concepts: [
          { id: 'async-await', label: 'async' },
          { id: 'zzz', label: 'Zed' },
          ...Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, label: `x${i}` })),
        ],
        exploreNext: Array.from({ length: 5 }, (_, i) => ({ text: `q${i}` })),
      },
      'block',
    );
    expect(b.concepts).toHaveLength(4);
    expect(b.concepts[1]).toEqual({ id: 'other:Zed', label: 'Zed' });
    expect(b.exploreNext).toHaveLength(3);
  });
  it.each([[null], [{}], [{ what: 42 }], [{ ...base, what: { text: '  ', refs: [] } }]])(
    'rejects bad output %j',
    (raw) => {
      expect(() => normaliseExplanation(raw, 'function')).toThrow(ModelOutputError);
    },
  );
});

describe('normaliseCheck', () => {
  it('requires four options and a correct index', () => {
    expect(() =>
      normaliseCheck({
        type: 'why',
        question: 'q',
        options: ['a', 'b'],
        correctIndex: 0,
        answerRefs: [],
        explanation: 'e',
      }),
    ).toThrow();
    expect(
      normaliseCheck({
        type: 'why',
        question: 'q',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 1,
        answerRefs: [{ path: 'a', line: 1 }],
        explanation: 'e',
      }).correctIndex,
    ).toBe(1);
  });
});

describe('costUsd', () => {
  const cfg = loadConfig({ DATABASE_URL: 'postgres://x/y' } as NodeJS.ProcessEnv);
  it('uses per-million-token rates from configuration', () => {
    expect(costUsd(cfg, 'fast', 1_000_000, 0)).toBeCloseTo(0.1);
    expect(costUsd(cfg, 'fast', 5000, 700)).toBeCloseTo(0.00085, 6);
    expect(costUsd(cfg, 'strong', 6000, 500)).toBeCloseTo(0.017, 6);
  });
});
