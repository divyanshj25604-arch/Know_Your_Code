import { describe, expect, it } from 'vitest';
import { analyse, stableSymbolKeys, type AnalysisInput, type SymbolRow } from '../src';
import { analysable, loadFixture } from './fixture-loader';

const keysOf = (symbols: SymbolRow[]) => symbols.map((s) => s.key);
const keyFor = (symbols: SymbolRow[], path: string, qualifiedName: string, kind?: string) =>
  symbols
    .filter((s) => s.path === path && s.qualifiedName === qualifiedName && (!kind || s.kind === kind))
    .map((s) => s.key);

async function run(files: AnalysisInput[]) {
  return analyse(files, { knownPaths: files.map((f) => f.path) });
}

describe('stable symbol keys', () => {
  it.each(['express-cjs', 'react-ts', 'broken', 'dynamic'])(
    'are unique, and identical when the same code is analysed again (%s)',
    async (fixture) => {
      const files = analysable(loadFixture(fixture));
      const a = await run(files);
      const b = await run(files);
      expect(keysOf(b.symbols)).toEqual(keysOf(a.symbols));
      expect(new Set(keysOf(a.symbols)).size).toBe(a.symbols.length);
      // Edges refer to symbols by the same stable keys.
      const keys = new Set(keysOf(a.symbols));
      for (const e of a.edges) {
        if (e.sourceKey) expect(keys.has(e.sourceKey)).toBe(true);
        if (e.targetKey) expect(keys.has(e.targetKey)).toBe(true);
      }
      expect(b.edges).toEqual(a.edges);
    },
  );

  it('do not depend on the order files are given in', async () => {
    const files = analysable(loadFixture('express-cjs'));
    const forward = await run(files);
    const backward = await run([...files].reverse());
    expect(new Set(keysOf(backward.symbols))).toEqual(new Set(keysOf(forward.symbols)));
  });

  it('name the structure, not database ids or offsets', async () => {
    const r = await run(analysable(loadFixture('express-cjs')));
    expect(keyFor(r.symbols, 'src/controllers/authController.js', 'login', 'function')).toEqual([
      'src/controllers/authController.js#function:login',
    ]);
    expect(keyFor(r.symbols, 'src/controllers/authController.js', 'login.req', 'parameter')).toEqual([
      'src/controllers/authController.js#function:login/parameter:req',
    ]);
    for (const s of r.symbols) {
      expect(s.key.startsWith(`${s.path}#`)).toBe(true);
      expect(s.key).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no UUIDs
    }
  });

  it('survive edits elsewhere in the file (no line numbers in keys)', async () => {
    const before = await run([
      { path: 'a.ts', content: 'export function a() {}\nexport function b(x: number) { return x; }\n' },
    ]);
    const after = await run([
      {
        path: 'a.ts',
        content:
          '// new header\nimport z from "z";\n\nexport function inserted() {}\nexport function a() {}\n\n\nexport function b(x: number) { return x; }\n',
      },
    ]);
    const kb = keysOf(before.symbols);
    const ka = new Set(keysOf(after.symbols));
    expect(kb.every((k) => ka.has(k))).toBe(true);
  });

  it('disambiguate overloads, same-named locals and repeated callbacks by source order', async () => {
    const r = await run([
      {
        path: 'src/o.ts',
        content: [
          'export function parse(x: string): number;',
          'export function parse(x: number): number;',
          'export function parse(x: unknown): number { return Number(x); }',
          'function host(flag: boolean) {',
          '  if (flag) { const tmp = () => { return 1; }; tmp(); }',
          '  else { const tmp = () => { return 2; }; tmp(); }',
          '}',
          'list.map((x) => {',
          '  return x;',
          '});',
          'list.map((y) => {',
          '  return y;',
          '});',
        ].join('\n'),
      },
    ]);
    const keys = keysOf(r.symbols);
    expect(keys).toContain('src/o.ts#function:parse');
    expect(keys).toContain('src/o.ts#function:parse~2');
    expect(keys).toContain('src/o.ts#function:parse~3');
    expect(keys).toContain('src/o.ts#function:host/function:tmp');
    expect(keys).toContain('src/o.ts#function:host/function:tmp~2');
    expect(keys).toContain('src/o.ts#function:list.map callback');
    expect(keys).toContain('src/o.ts#function:list.map callback~2');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('nest through classes, methods and object-literal methods', async () => {
    const r = await run([
      {
        path: 'src/c.ts',
        content:
          'export class Cart {\n  add(item: string) { return item; }\n  get size() { return 0; }\n}\nexport const api = {\n  get(id: string) { return id; },\n};\n',
      },
    ]);
    const keys = keysOf(r.symbols);
    expect(keys).toContain('src/c.ts#class:Cart/method:add/parameter:item');
    expect(keys).toContain('src/c.ts#class:Cart/method:size');
    // Object-literal methods are 'method' symbols named owner.prop (their qualifiedName doubling is risk T15).
    expect(keys).toContain('src/c.ts#variable:api/method:api.get/parameter:id');
  });

  it('escape separators so different names can never produce the same key', () => {
    const base = {
      kind: 'function' as const,
      tags: [],
      exported: false,
      signature: null,
      startCol: 0,
      endLine: 1,
      endCol: 1,
    };
    const rows: SymbolRow[] = [
      {
        ...base,
        key: 'k1',
        path: 'p#q.ts',
        name: 'a/b',
        qualifiedName: 'a/b',
        startLine: 1,
        parentKey: null,
      },
      { ...base, key: 'k2', path: 'p#q.ts', name: 'a', qualifiedName: 'a', startLine: 2, parentKey: null },
      { ...base, key: 'k3', path: 'p#q.ts', name: 'b', qualifiedName: 'a.b', startLine: 3, parentKey: 'k2' },
      {
        ...base,
        key: 'k4',
        path: 'p#q.ts',
        name: 'x~2',
        qualifiedName: 'x~2',
        startLine: 4,
        parentKey: null,
      },
      { ...base, key: 'k5', path: 'p#q.ts', name: 'x', qualifiedName: 'x', startLine: 5, parentKey: null },
      { ...base, key: 'k6', path: 'p#q.ts', name: 'x', qualifiedName: 'x', startLine: 6, parentKey: null },
    ];
    const keys = stableSymbolKeys(rows);
    expect(keys.get('k1')).toBe('p%23q.ts#function:a%2Fb');
    expect(keys.get('k3')).toBe('p%23q.ts#function:a/function:b');
    expect(keys.get('k4')).toBe('p%23q.ts#function:x%7E2');
    expect(keys.get('k6')).toBe('p%23q.ts#function:x~2');
    expect(new Set(keys.values()).size).toBe(rows.length);
    // Control characters (multi-line callee text) and the path separator '#' are encoded too.
    const ctl = stableSymbolKeys([
      {
        ...base,
        key: 'c1',
        path: 'a.js',
        name: 'x\ny\tz',
        qualifiedName: 'q',
        startLine: 1,
        parentKey: null,
      },
    ]);
    expect(ctl.get('c1')).toBe('a.js#function:x%0Ay%09z');
  });

  it('document their limitations: a rename re-keys, as does inserting a same-named sibling before', async () => {
    const one = await run([{ path: 'a.ts', content: 'function f(a: number) { return a; }\n' }]);
    const moved = await run([{ path: 'b.ts', content: 'function f(a: number) { return a; }\n' }]);
    expect(keysOf(moved.symbols)).not.toEqual(keysOf(one.symbols));

    const two = await run([
      { path: 'a.ts', content: 'function f(a: string): number;\nfunction f(a: number) { return a; }\n' },
    ]);
    // The implementation used to be `f`; with a signature inserted before it, it is now `f~2`.
    expect(keyFor(two.symbols, 'a.ts', 'f').sort()).toEqual(['a.ts#function:f', 'a.ts#function:f~2']);
  });
});
