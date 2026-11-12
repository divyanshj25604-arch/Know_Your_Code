import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FileGraphView, FileOutlineView } from '@kyc/contracts';
import { FakeLlm } from '../src/ai/fake';
import { runImport } from '../src/jobs/importJob';
import { Device } from './device';
import { Harness } from './harness';

const h = new Harness();
const app = () => h.app;
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() =>
  h.reset({
    llm: new FakeLlm(),
    repos: { 'acme/shop': { fixture: 'react-ts' }, 'acme/notes-api': { fixture: 'express-cjs' } },
  }),
);
afterEach(() => h.close());

const graphOf = async (d: Device, snapshotId: string, x?: Record<string, string>) =>
  (await d.get(`/api/v1/snapshots/${snapshotId}/file-graph`, x)).json() as FileGraphView;
const outlineUrl = (snapshotId: string, path: string) =>
  `/api/v1/snapshots/${snapshotId}/file-outline?path=${encodeURIComponent(path)}`;

describe('file graph', () => {
  it('aggregates import, call and JSX reference edges between files, with externals, and no self edges', async () => {
    const d = new Device(app);
    const { snapshotId } = await d.importRepo('acme/shop');
    const g = await graphOf(d, snapshotId);

    expect(g.files.map((f) => f.path)).toEqual([
      'src/components/Cart.tsx',
      'src/components/Price.tsx',
      'src/lib/format.ts',
      'src/main.tsx',
    ]);
    expect(g.files.find((f) => f.path === 'src/components/Cart.tsx')).toEqual({
      path: 'src/components/Cart.tsx',
      module: 'dir:src/components',
      symbols: 8, // Cart, open, setOpen, useEffect callback, total, shown, Counter, increment (no parameters/imports)
      analysable: true,
    });
    expect(g.files.find((f) => f.path === 'src/lib/format.ts')!.symbols).toBe(2);

    expect(g.edges).toEqual([
      {
        from: 'src/components/Cart.tsx',
        to: 'src/components/Price.tsx',
        kind: 'imports',
        count: 1,
        line: 2,
        provenance: 'verified',
      },
      {
        from: 'src/components/Cart.tsx',
        to: 'src/components/Price.tsx',
        kind: 'references',
        count: 1,
        line: 18,
        provenance: 'verified',
        jsx: true,
      },
      {
        from: 'src/components/Cart.tsx',
        to: 'src/lib/format.ts',
        kind: 'calls',
        count: 1,
        line: 13,
        provenance: 'verified',
      },
      {
        from: 'src/components/Cart.tsx',
        to: 'src/lib/format.ts',
        kind: 'imports',
        count: 1,
        line: 3,
        provenance: 'verified',
      },
      {
        from: 'src/components/Price.tsx',
        to: 'src/lib/format.ts',
        kind: 'calls',
        count: 1,
        line: 8,
        provenance: 'verified',
      },
      // `@/lib/format` resolved through the tsconfig path alias.
      {
        from: 'src/components/Price.tsx',
        to: 'src/lib/format.ts',
        kind: 'imports',
        count: 1,
        line: 1,
        provenance: 'verified',
      },
      {
        from: 'src/main.tsx',
        to: 'src/components/Cart.tsx',
        kind: 'imports',
        count: 1,
        line: 2,
        provenance: 'verified',
      },
      {
        from: 'src/main.tsx',
        to: 'src/components/Cart.tsx',
        kind: 'references',
        count: 1,
        line: 4,
        provenance: 'verified',
        jsx: true,
      },
    ]);
    for (const e of g.edges) expect(e.from).not.toBe(e.to);

    // `react-dom/client` is reported as its package; calls into packages are counted per file.
    expect(g.externals).toEqual([
      { from: 'src/components/Cart.tsx', package: 'react', kind: 'calls', count: 3, line: 6 },
      { from: 'src/components/Cart.tsx', package: 'react', kind: 'imports', count: 1, line: 1 },
      { from: 'src/main.tsx', package: 'react-dom', kind: 'calls', count: 2, line: 4 },
      { from: 'src/main.tsx', package: 'react-dom', kind: 'imports', count: 1, line: 1 },
    ]);
  });

  it('counts grouped edges, downgrades provenance when any is a pattern, and is stable across re-analysis', async () => {
    const d = new Device(app);
    const { snapshotId } = await d.importRepo('acme/notes-api');
    const before = await graphOf(d, snapshotId);
    // Self-file references (module.exports = { login }) and route registrations are not file edges.
    expect(before.edges.filter((e) => e.from === e.to)).toEqual([]);
    expect(
      before.edges.find(
        (e) =>
          e.from === 'src/routes/auth.js' &&
          e.to === 'src/controllers/authController.js' &&
          e.kind === 'references',
      ),
    ).toEqual({
      from: 'src/routes/auth.js',
      to: 'src/controllers/authController.js',
      kind: 'references',
      count: 1,
      line: 4,
      provenance: 'verified',
      jsx: false,
    });
    expect(before.externals.find((x) => x.from === 'src/app.js' && x.kind === 'calls')).toMatchObject({
      package: 'express',
      count: 5,
    });

    // Re-analysis replaces the run: the graph reads only the current run, so nothing is double counted.
    await runImport(
      { config: h.app.services.config, db: h.db, github: h.app.services.github, log: h.app.log },
      snapshotId,
    );
    expect(await graphOf(d, snapshotId)).toEqual(before);

    // A second, pattern-provenance call from the controller into the service file joins the existing group.
    await h.db.query(
      `INSERT INTO edges (snapshot_id, analysis_run_id, type, source_symbol_id, source_file_id, target_symbol_id, line,
                          provenance)
       SELECT e.snapshot_id, e.analysis_run_id, 'calls', e.source_symbol_id, e.source_file_id, e.target_symbol_id, 2,
              'pattern'
       FROM edges e JOIN snapshots s ON s.current_analysis_run_id = e.analysis_run_id
       JOIN files f ON f.id = e.source_file_id
       WHERE s.id=$1 AND e.type='calls' AND f.path='src/controllers/authController.js' AND e.target_symbol_id IS NOT NULL`,
      [snapshotId],
    );
    const after = await graphOf(d, snapshotId);
    expect(
      after.edges.find(
        (e) =>
          e.from === 'src/controllers/authController.js' &&
          e.to === 'src/services/userService.js' &&
          e.kind === 'calls',
      ),
    ).toEqual({
      from: 'src/controllers/authController.js',
      to: 'src/services/userService.js',
      kind: 'calls',
      count: 2,
      line: 2,
      provenance: 'pattern',
    });
  });
});

describe('file outline', () => {
  it('lists symbols, imports, importers and symbol edges with both ends in view', async () => {
    const d = new Device(app);
    const { snapshotId } = await d.importRepo('acme/notes-api');
    const res = await d.get(outlineUrl(snapshotId, 'src/controllers/authController.js'));
    expect(res.statusCode).toBe(200);
    const o = res.json() as FileOutlineView;
    expect(o).toMatchObject({
      path: 'src/controllers/authController.js',
      language: 'js',
      analysable: true,
      lines: 10,
      module: { key: 'dir:src/controllers', name: 'controllers' },
    });
    expect(o.symbols.map((s) => [s.name, s.kind, s.startLine])).toEqual([
      ['login', 'function', 3],
      ['user', 'variable', 4],
    ]);
    const login = o.symbols[0]!;
    expect(login).toMatchObject({
      key: 'src/controllers/authController.js#function:login',
      exported: true,
      endLine: 7,
      parentId: null,
    });
    expect(o.symbols[1]!.parentId).toBe(login.id);
    expect(o.imports).toEqual([
      { path: 'src/services/userService.js', external: null, line: 1, provenance: 'verified' },
    ]);
    expect(o.importedBy).toEqual([{ path: 'src/routes/auth.js', line: 2, provenance: 'verified' }]);

    const call = o.symbolEdges.find((e) => e.to.name === 'findUserByEmail')!;
    expect(call).toMatchObject({
      kind: 'calls',
      from: { symbolId: login.id, name: 'login', path: 'src/controllers/authController.js' },
      to: { name: 'findUserByEmail', path: 'src/services/userService.js', line: 7, external: null },
      line: 4,
      provenance: 'verified',
      reason: null,
    });
    // Unresolved calls stay visible with their reason; nothing is guessed.
    expect(o.symbolEdges.filter((e) => e.reason === 'no_declaration').length).toBe(3);
    // Incoming edges from another file: the route registration (a pattern) and the reference to the handler.
    expect(o.symbolEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'route_handler',
          from: { symbolId: null, name: null, path: 'src/routes/auth.js' },
          to: expect.objectContaining({ symbolId: login.id, name: 'login', line: 3 }),
          provenance: 'pattern',
        }),
        expect.objectContaining({
          kind: 'references',
          from: expect.objectContaining({ path: 'src/routes/auth.js' }),
          jsx: false,
        }),
      ]),
    );
  });

  it('shows JSX uses, external imports and calls into packages', async () => {
    const d = new Device(app);
    const { snapshotId } = await d.importRepo('acme/shop');
    const o = (await d.get(outlineUrl(snapshotId, 'src/components/Cart.tsx'))).json() as FileOutlineView;
    expect(o.symbols.map((s) => s.name)).toContain('Counter');
    expect(o.symbols.some((s) => s.kind === 'parameter' || s.kind === 'import')).toBe(false);
    expect(o.imports[0]).toEqual({ path: null, external: 'react', line: 1, provenance: 'verified' });
    expect(o.importedBy).toEqual([{ path: 'src/main.tsx', line: 2, provenance: 'verified' }]);
    expect(o.symbolEdges.filter((e) => e.to.external === 'react').length).toBe(3);
    expect(o.symbolEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'references',
          jsx: true,
          to: expect.objectContaining({ name: 'Price' }),
        }),
        expect.objectContaining({
          kind: 'references',
          jsx: true,
          from: expect.objectContaining({ path: 'src/main.tsx' }),
        }),
      ]),
    );
  });

  it('answers FILE_NOT_FOUND for an unknown path and 400 without one', async () => {
    const d = new Device(app);
    const { snapshotId } = await d.importRepo('acme/notes-api');
    const res = await d.get(outlineUrl(snapshotId, 'src/nope.js'));
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('FILE_NOT_FOUND');
    expect((await d.get(`/api/v1/snapshots/${snapshotId}/file-outline`)).statusCode).toBe(400);
  });
});

describe('graph authorization', () => {
  it('is owner-or-share-token, like every snapshot read', async () => {
    const owner = new Device(app);
    const { snapshotId } = await owner.importRepo('acme/notes-api');
    const graph = `/api/v1/snapshots/${snapshotId}/file-graph`;
    const outline = outlineUrl(snapshotId, 'src/app.js');
    const stranger = new Device(app);
    expect((await stranger.get(graph)).statusCode).toBe(404);
    expect((await stranger.get(outline)).statusCode).toBe(404);
    // A stranger asking for an unknown path learns nothing either (404 NOT_FOUND, not FILE_NOT_FOUND).
    expect((await stranger.get(outlineUrl(snapshotId, 'x.js'))).json().error.code).toBe('NOT_FOUND');

    const share = await owner.post(`/api/v1/snapshots/${snapshotId}/share-tokens`, { ttlHours: 24 });
    const x = { 'x-kyc-share': share.json().token as string };
    expect((await stranger.get(graph, x)).statusCode).toBe(200);
    expect((await stranger.get(graph, x)).json()).toEqual(await graphOf(owner, snapshotId));
    expect((await stranger.get(outline, x)).statusCode).toBe(200);

    // Revoked tokens stop working.
    await owner.delete(`/api/v1/snapshots/${snapshotId}/share-tokens`);
    expect((await stranger.get(graph, x)).statusCode).toBe(404);
  });
});
