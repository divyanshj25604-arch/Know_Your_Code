import { describe, expect, it } from 'vitest';
import { analyse } from '../src';
import { analysable, loadFixture } from './fixture-loader';

const tagged = async (files: { path: string; content: string }[]) => {
  const r = await analyse(files, { knownPaths: files.map((f) => f.path) });
  return (name: string) =>
    r.symbols
      .find((s) => s.qualifiedName === name && (s.kind === 'function' || s.kind === 'method'))
      ?.tags.filter((t) => t.startsWith('concept:'))
      .map((t) => t.slice(8)) ?? [];
};

describe('concept detection (P3.3)', () => {
  it('tags each function with the concepts its own body shows', async () => {
    const t = await tagged([
      {
        path: 'src/a.js',
        content: [
          'async function load(id) {',
          '  try {',
          '    const { data } = await fetchIt(id);',
          '    return data?.items.map((x) => x.name);',
          '  } catch (e) {',
          '    throw new Error("bad");',
          '  }',
          '}',
          'function counter(start) {',
          '  let n = start;',
          '  return function next() { n += 1; return n; };',
          '}',
          'function mw(req, res, next) { if (!req.body) return res.status(400).json({}); next(); }',
          'function later(s) { const v = JSON.parse(s); return new Promise((r) => setTimeout(r, 1)).then(() => v); }',
        ].join('\n'),
      },
    ]);
    expect(t('load')).toEqual(
      expect.arrayContaining([
        'async-await',
        'try-catch',
        'error-handling',
        'destructuring',
        'array-methods',
        'optional-chaining',
      ]),
    );
    expect(t('counter')).toContain('closures');
    expect(t('mw')).toEqual(expect.arrayContaining(['express-middleware', 'http-request-response']));
    expect(t('later')).toEqual(expect.arrayContaining(['promises', 'callbacks', 'json']));
    // Nested functions are judged on their own: the inner arrow in load is not "try-catch".
    expect(t('next')).not.toContain('try-catch');
  });

  it('finds async/await in two different files of the Express fixture', async () => {
    const files = analysable(loadFixture('express-cjs'));
    const r = await analyse(files, { knownPaths: files.map((f) => f.path) });
    const withAsync = r.symbols.filter((s) => s.tags.includes('concept:async-await')).map((s) => s.path);
    expect(new Set(withAsync).size).toBeGreaterThanOrEqual(2);
  });
});
