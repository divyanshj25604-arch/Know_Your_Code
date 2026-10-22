import { describe, expect, it } from 'vitest';
import { analyse, readPathAliases } from '../src/analysis/analyse';
import type { AnalysisResult, EdgeRow, SymbolRow } from '../src/analysis/types';
import { analysable, loadFixture } from './fixture-loader';

async function run(name: string) {
  const all = loadFixture(name);
  return await analyse(analysable(all), {
    knownPaths: all.map((f) => f.path),
    aliases: readPathAliases(all),
  });
}

const sym = (r: AnalysisResult, path: string, name: string, kind?: string): SymbolRow => {
  const s = r.symbols.find((x) => x.path === path && x.name === name && (!kind || x.kind === kind));
  if (!s)
    throw new Error(
      `symbol not found: ${path} ${name}\n${r.symbols.map((x) => `${x.path}:${x.name}:${x.kind}`).join('\n')}`,
    );
  return s;
};
const edges = (r: AnalysisResult, f: (e: EdgeRow) => boolean) => r.edges.filter(f);

describe('analyse: Express CommonJS fixture (C1-style)', async () => {
  const r = await run('express-cjs');

  it('extracts functions with ranges, signatures and exported flag', () => {
    const login = sym(r, 'src/controllers/authController.js', 'login', 'function');
    expect(login).toMatchObject({
      startLine: 3,
      endLine: 7,
      exported: true,
      signature: 'async function login(req, res)',
    });
    expect(sym(r, 'src/services/userService.js', 'normalise', 'function').exported).toBe(false);
  });

  it('extracts parameters and require() bindings as imports', () => {
    expect(sym(r, 'src/controllers/authController.js', 'req', 'parameter').parentKey).toBe(
      sym(r, 'src/controllers/authController.js', 'login').key,
    );
    expect(sym(r, 'src/controllers/authController.js', 'findUserByEmail', 'import').tags).toContain(
      'require',
    );
  });

  it('resolves a destructured require() call across files (login -> findUserByEmail)', () => {
    const login = sym(r, 'src/controllers/authController.js', 'login');
    const target = sym(r, 'src/services/userService.js', 'findUserByEmail', 'function');
    const e = edges(r, (x) => x.type === 'calls' && x.sourceKey === login.key && x.targetKey === target.key);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ provenance: 'verified', line: 4, reason: null });
  });

  it('resolves same-file calls (findUserByEmail -> normalise)', () => {
    const a = sym(r, 'src/services/userService.js', 'findUserByEmail');
    const b = sym(r, 'src/services/userService.js', 'normalise');
    expect(
      edges(r, (x) => x.type === 'calls' && x.sourceKey === a.key && x.targetKey === b.key),
    ).toHaveLength(1);
  });

  it('records import edges between files and to external packages', () => {
    const imp = edges(r, (e) => e.type === 'imports' && e.sourcePath === 'src/routes/auth.js');
    expect(imp.map((e) => e.targetPath ?? `ext:${e.targetExternal}`).sort()).toEqual([
      'ext:express',
      'src/controllers/authController.js',
    ]);
    expect(imp.find((e) => e.targetExternal === 'express')).toMatchObject({ reason: 'external_package' });
  });

  it('records the route registration as a pattern (not verified) edge to the handler', () => {
    const login = sym(r, 'src/controllers/authController.js', 'login');
    const e = edges(r, (x) => x.type === 'route_handler' && x.targetKey === login.key);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      provenance: 'pattern',
      line: 4,
      sourcePath: 'src/routes/auth.js',
      meta: { method: 'POST', path: '/login' },
    });
  });

  it('gives inline route handlers a named symbol and a pattern edge', () => {
    const h = sym(r, 'src/app.js', 'GET /health', 'function');
    expect(h.tags).toContain('route-handler');
    expect(edges(r, (x) => x.type === 'route_handler' && x.targetKey === h.key)).toHaveLength(1);
  });

  it('marks calls into external packages as unresolved with the package name', () => {
    const user = edges(
      r,
      (e) =>
        e.type === 'calls' &&
        e.sourcePath === 'src/services/userService.js' &&
        e.targetExternal === null &&
        e.reason !== null,
    );
    // User.findOne(...) comes from a local model (resolvable file) whose export is an external call result: unknown declaration.
    expect(user.some((e) => (e.meta as { calleeText?: string }).calleeText === 'User.findOne')).toBe(true);
    const mongoose = edges(
      r,
      (e) => e.sourcePath === 'src/models/user.js' && e.targetExternal === 'mongoose',
    );
    expect(mongoose.length).toBeGreaterThan(0);
  });

  it('does not report JS built-ins (console, Array methods) as unresolved noise', () => {
    expect(
      edges(
        r,
        (e) =>
          e.type === 'calls' &&
          /^(Math|console|JSON)\./.test(String((e.meta as { calleeText?: string }).calleeText ?? '')),
      ),
    ).toHaveLength(0);
  });

  it('never invents an edge whose target is not a known symbol', () => {
    const keys = new Set(r.symbols.map((s) => s.key));
    for (const e of r.edges) {
      if (e.targetKey) expect(keys.has(e.targetKey)).toBe(true);
      if (e.sourceKey) expect(keys.has(e.sourceKey)).toBe(true);
      if (e.reason) expect(e.targetKey).toBeNull();
    }
  });
});

describe('analyse: React + TypeScript fixture with path aliases (C3-style)', async () => {
  const r = await run('react-ts');

  it('reads tsconfig paths despite JSONC comments and trailing commas', () => {
    const all = loadFixture('react-ts');
    expect(readPathAliases(all)).toMatchObject({ baseUrl: '.', paths: { '@/*': ['src/*'] } });
  });

  it('resolves an @/ alias import to the target file', () => {
    const e = edges(r, (x) => x.type === 'imports' && x.sourcePath === 'src/components/Price.tsx');
    expect(e[0]).toMatchObject({ targetPath: 'src/lib/format.ts', reason: null });
  });

  it('resolves calls through aliased imports and arrow-function exports', () => {
    const price = sym(r, 'src/components/Price.tsx', 'Price');
    const fmt = sym(r, 'src/lib/format.ts', 'formatPrice');
    expect(
      edges(r, (x) => x.type === 'calls' && x.sourceKey === price.key && x.targetKey === fmt.key),
    ).toHaveLength(1);
    const cart = sym(r, 'src/components/Cart.tsx', 'Cart');
    const clamp = sym(r, 'src/lib/format.ts', 'clamp');
    expect(
      edges(r, (x) => x.type === 'calls' && x.sourceKey === cart.key && x.targetKey === clamp.key),
    ).toHaveLength(1);
  });

  it('tags React components and records JSX usage as a reference (not a call)', () => {
    expect(sym(r, 'src/components/Cart.tsx', 'Cart').tags).toContain('react-component');
    const price = sym(r, 'src/components/Price.tsx', 'Price');
    const e = edges(r, (x) => x.type === 'references' && x.targetKey === price.key);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ sourcePath: 'src/components/Cart.tsx', meta: { jsx: true } });
    expect(edges(r, (x) => x.type === 'calls' && x.targetKey === price.key)).toHaveLength(0);
  });

  it('names callbacks that deserve a symbol (useEffect) and attributes their calls', () => {
    expect(sym(r, 'src/components/Cart.tsx', 'useEffect callback').tags).toContain('callback');
  });

  it('extracts classes and methods with qualified names', () => {
    expect(sym(r, 'src/components/Cart.tsx', 'Counter', 'class').exported).toBe(true);
    expect(sym(r, 'src/components/Cart.tsx', 'increment', 'method').qualifiedName).toBe('Counter.increment');
  });

  it('marks hook calls into React as external', () => {
    const cart = sym(r, 'src/components/Cart.tsx', 'Cart');
    expect(
      edges(
        r,
        (x) => x.sourceKey === cart.key && x.targetExternal === 'react' && x.reason === 'external_package',
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe('analyse: syntax errors and dynamic code', () => {
  it('keeps good files, reports the broken one as a parse_error, and creates no symbols from it', async () => {
    const r = await run('broken');
    expect(r.symbols.some((s) => s.path === 'good.js' && s.name === 'ok')).toBe(true);
    expect(r.symbols.filter((s) => s.path === 'bad.js')).toHaveLength(0);
    expect(r.failedFiles).toEqual([{ path: 'bad.js', reason: 'parse_error' }]);
    expect(r.diagnostics[0]).toMatchObject({ path: 'bad.js', kind: 'syntax_error' });
  });

  it('flags imports of a broken file as parse_error rather than inventing symbols', async () => {
    const files = [
      { path: 'a.js', content: "const { f } = require('./bad');\nfunction g() { return f(); }\n" },
      { path: 'bad.js', content: 'function f( {' },
    ];
    const r = await analyse(files);
    expect(r.edges.find((e) => e.type === 'imports')).toMatchObject({
      targetPath: 'bad.js',
      reason: 'parse_error',
    });
    expect(r.edges.find((e) => e.type === 'calls')).toMatchObject({ reason: 'parse_error', targetKey: null });
  });

  it('marks dynamic require/import and computed member calls as unresolved with reasons', async () => {
    const r = await run('dynamic');
    const reasons = r.edges.filter((e) => e.reason).map((e) => e.reason);
    expect(reasons).toContain('dynamic_import');
    expect(reasons).toContain('computed_member');
    expect(r.edges.filter((e) => e.type === 'imports' && e.reason === 'dynamic_import')).toHaveLength(2);
  });

  it('handles an empty input and an empty file', async () => {
    expect((await analyse([])).symbols).toEqual([]);
    expect((await analyse([{ path: 'e.js', content: '' }])).symbols).toEqual([]);
  });

  it('records a missing relative import as no_declaration', async () => {
    const r = await analyse([{ path: 'a.js', content: "const x = require('./nope');\n" }]);
    expect(r.edges[0]).toMatchObject({ type: 'imports', reason: 'no_declaration', targetPath: null });
  });

  it('treats view-only files (json) as resolvable import targets', async () => {
    const r = await analyse([{ path: 'a.js', content: "const cfg = require('./config.json');\n" }], {
      knownPaths: ['a.js', 'config.json'],
    });
    expect(r.edges[0]).toMatchObject({ targetPath: 'config.json', reason: null });
  });
});
