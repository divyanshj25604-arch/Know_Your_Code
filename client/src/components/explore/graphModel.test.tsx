import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ArchitectureView, FileGraphView, FileOutlineView, FlowDetail, Relations } from '@kyc/contracts';
import { layered } from '../graph/layout';
import { GraphCanvas } from '../graph/GraphCanvas';
import {
  buildApplication,
  buildDependencies,
  buildFile,
  buildFlow,
  buildFunction,
  buildModule,
  noteTarget,
} from './graphModel';

const none = () => 0;
const all = new Set(['imports', 'calls', 'uses', 'packages']);

const arch: ArchitectureView = {
  available: true,
  monorepo: false,
  modules: [
    { key: 'routes', name: 'routes', kind: 'directory', root: 'src/routes', files: ['src/routes/auth.js'] },
    {
      key: 'ctl',
      name: 'controllers',
      kind: 'directory',
      root: 'src/controllers',
      files: ['src/controllers/a.js', 'src/controllers/b.js'],
    },
    { key: 'svc', name: 'services', kind: 'directory', root: 'src/services', files: ['src/services/s.js'] },
  ],
  dependencies: [
    { from: 'routes', to: 'ctl', imports: 1 },
    { from: 'ctl', to: 'svc', imports: 2 },
  ],
};
const fg: FileGraphView = {
  files: [
    { path: 'src/routes/auth.js', module: 'routes', symbols: 1, analysable: true },
    { path: 'src/controllers/a.js', module: 'ctl', symbols: 2, analysable: true },
    { path: 'src/controllers/b.js', module: 'ctl', symbols: 1, analysable: true },
    { path: 'src/services/s.js', module: 'svc', symbols: 1, analysable: true },
  ],
  edges: [
    {
      from: 'src/routes/auth.js',
      to: 'src/controllers/a.js',
      kind: 'imports',
      count: 1,
      line: 1,
      provenance: 'verified',
    },
    {
      from: 'src/controllers/a.js',
      to: 'src/services/s.js',
      kind: 'imports',
      count: 1,
      line: 1,
      provenance: 'verified',
    },
    {
      from: 'src/controllers/a.js',
      to: 'src/services/s.js',
      kind: 'calls',
      count: 3,
      line: 7,
      provenance: 'verified',
    },
    {
      from: 'src/controllers/b.js',
      to: 'src/controllers/a.js',
      kind: 'references',
      count: 1,
      line: 2,
      provenance: 'pattern',
      jsx: true,
    },
  ],
  externals: [
    { from: 'src/services/s.js', package: 'mongoose', kind: 'calls', count: 2, line: 4 },
    { from: 'src/routes/auth.js', package: 'express', kind: 'calls', count: 1, line: 2 },
  ],
};

describe('layered layout', () => {
  it('is deterministic, survives cycles and puts dependencies to the right', () => {
    const nodes = ['a', 'b', 'c'].map((id) => ({ id }));
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
    ];
    const o = { direction: 'LR' as const, nodeWidth: 100, nodeHeight: 40, rankGap: 50, nodeGap: 10 };
    const one = layered(nodes, edges, o);
    const two = layered(nodes, edges, o);
    expect([...one.positions]).toEqual([...two.positions]);
    expect(one.positions.get('a')!.x).toBeLessThan(one.positions.get('b')!.x);
    expect(one.positions.get('b')!.x).toBeLessThan(one.positions.get('c')!.x);
  });
  it('honours fixed ranks (callers left, focus centre, callees right)', () => {
    const l = layered([{ id: 'x' }, { id: 'f' }, { id: 'y' }], [], {
      direction: 'LR',
      nodeWidth: 100,
      nodeHeight: 40,
      rankGap: 50,
      nodeGap: 10,
      fixedRank: new Map([
        ['x', 0],
        ['f', 1],
        ['y', 2],
      ]),
    });
    expect(l.positions.get('x')!.rank).toBe(0);
    expect(l.positions.get('y')!.rank).toBe(2);
  });
});

describe('graph builders draw only what the analysis found', () => {
  it('application level: modules, verified module imports, and database clients marked Likely', () => {
    const b = buildApplication(arch, fg, none);
    expect(b.nodes.map((n) => n.label)).toEqual(['routes', 'controllers', 'services', 'mongoose', 'express']);
    expect(b.edges.find((e) => e.id === 'md:ctl>svc')).toMatchObject({
      label: 'imports ×2',
      provenance: 'verified',
    });
    const db = b.nodes.find((n) => n.label === 'mongoose')!;
    expect(db).toMatchObject({ kind: 'database', provenance: 'pattern' });
    expect(b.nodes.find((n) => n.label === 'express')).toMatchObject({ kind: 'package' });
    expect(b.nodes.every((n) => n.kind !== 'module' || n.canDrill)).toBe(true);
  });

  it('module level: its files, combined relationship labels, other modules as single nodes', () => {
    const b = buildModule(arch, fg, 'ctl', none, all);
    expect(
      b.nodes
        .filter((n) => n.kind === 'file')
        .map((n) => n.sub)
        .sort(),
    ).toEqual(['src/controllers/a.js', 'src/controllers/b.js']);
    // a.js imports and calls s.js: one edge to the services module, both words, count kept.
    expect(b.edges.find((e) => e.to === 'm:svc')?.label).toBe('imports, calls ×3');
    // A JSX reference is "renders"; a pattern-only edge is Likely, not Verified.
    expect(b.edges.find((e) => e.from === 'f:src/controllers/b.js')).toMatchObject({
      label: 'renders',
      provenance: 'pattern',
    });
    expect(b.nodes.some((n) => n.id === 'm:routes')).toBe(true);
    // Turning a kind off removes those edges.
    const noImports = buildModule(arch, fg, 'ctl', none, new Set(['calls']));
    expect(noImports.edges.find((e) => e.to === 'm:svc')?.label).toBe('calls ×3');
  });

  it('dependencies: importers on the left, what it uses on the right, packages it calls', () => {
    const b = buildDependencies(fg, 'src/controllers/a.js', none, all);
    expect(b.fixedRank!.get('f:src/routes/auth.js')).toBe(0);
    expect(b.fixedRank!.get('f:src/services/s.js')).toBe(2);
    expect(b.nodes.find((n) => n.id === 'f:src/controllers/a.js')?.kind).toBe('current');
    const rel = b.targets.get('de:src/controllers/a.js>src/services/s.js');
    expect(rel).toMatchObject({ kind: 'relation', path: 'src/controllers/a.js', line: 1 });
    expect(noteTarget(rel!)).toMatchObject({
      kind: 'relation',
      key: 'src/controllers/a.js|imports|src/services/s.js',
    });
  });

  it('file level: functions, calls between them, and unresolved calls grouped as Not sure with the reason', () => {
    const outline: FileOutlineView = {
      path: 'a.js',
      language: 'javascript',
      analysable: true,
      lines: 20,
      module: null,
      symbols: [
        {
          id: '1',
          key: 'k1',
          name: 'login',
          kind: 'function',
          tags: [],
          startLine: 1,
          endLine: 5,
          exported: true,
          signature: null,
          parentId: null,
        },
        {
          id: '2',
          key: 'k2',
          name: 'check',
          kind: 'function',
          tags: [],
          startLine: 7,
          endLine: 9,
          exported: false,
          signature: null,
          parentId: null,
        },
      ],
      imports: [],
      importedBy: [],
      symbolEdges: [
        {
          id: 'e1',
          kind: 'calls',
          from: { symbolId: '1', name: 'login', path: 'a.js' },
          to: { symbolId: '2', name: 'check', path: 'a.js', line: 7, external: null },
          line: 3,
          provenance: 'verified',
          reason: null,
        },
        {
          id: 'e2',
          kind: 'calls',
          from: { symbolId: '1', name: 'login', path: 'a.js' },
          to: { symbolId: '9', name: 'find', path: 'b.js', line: 4, external: null },
          line: 4,
          provenance: 'verified',
          reason: null,
        },
        {
          id: 'e3',
          kind: 'calls',
          from: { symbolId: '1', name: 'login', path: 'a.js' },
          to: { symbolId: null, name: null, path: null, line: null, external: null },
          line: 4,
          provenance: 'verified',
          reason: 'no_declaration',
        },
        {
          id: 'e4',
          kind: 'calls',
          from: { symbolId: '1', name: 'login', path: 'a.js' },
          to: { symbolId: null, name: null, path: null, line: null, external: 'express' },
          line: 2,
          provenance: 'verified',
          reason: 'external_package',
        },
      ],
    };
    const b = buildFile(outline, (k) => (k === 'k1' ? 2 : 0), true);
    expect(b.nodes.map((n) => n.label)).toEqual(['login()', 'check()', 'find', 'Not followed (1)']);
    expect(b.nodes[0]!.badge).toBe('✎ 2');
    expect(b.edges.find((e) => e.to === 'u:s:1')).toMatchObject({ provenance: 'unknown' });
    expect(b.nodes.find((n) => n.kind === 'unknown')?.hint).toContain('no declaration was found');
    // Hiding "Not sure" removes the node instead of drawing a guessed edge.
    expect(buildFile(outline, none, false).nodes.some((n) => n.kind === 'unknown')).toBe(false);
  });

  it('function level and request flow keep provenance and order', () => {
    const rel: Relations = {
      symbol: {
        id: 's',
        key: 'k',
        name: 'find',
        kind: 'function',
        signature: null,
        path: 's.js',
        startLine: 3,
        startCol: 0,
        endLine: 6,
        endCol: 1,
      },
      definedIn: null,
      calledBy: [
        { symbolId: 'l', label: 'login', path: 'a.js', line: 3, provenance: 'verified', via: 'call' },
      ],
      calls: [],
      imports: [],
      unresolved: [{ label: 'User.findOne', path: 's.js', line: 4, reason: 'no_declaration' }],
    };
    const f = buildFunction(rel, none, true);
    expect(f.fixedRank!.get('s:l')).toBe(0);
    expect(f.edges.map((e) => e.provenance).sort()).toEqual(['unknown', 'verified']);

    const flow = {
      id: 'f',
      snapshotId: 'x',
      name: 'POST /login',
      method: 'POST',
      routePath: '/login',
      clients: 0,
      stepCount: 3,
      unknownCount: 1,
      handler: null,
      steps: [
        {
          index: 0,
          kind: 'route',
          label: 'POST /login',
          path: 'r.js',
          line: 1,
          symbolId: null,
          symbolKey: null,
          provenance: 'pattern',
          depth: 0,
          reason: null,
          edgeId: null,
        },
        {
          index: 1,
          kind: 'handler',
          label: 'login',
          path: 'a.js',
          line: 3,
          symbolId: 'l',
          symbolKey: null,
          provenance: 'pattern',
          depth: 0,
          reason: null,
          edgeId: null,
        },
        {
          index: 2,
          kind: 'unknown',
          label: 'res.json',
          path: 'a.js',
          line: 5,
          symbolId: null,
          symbolKey: null,
          provenance: 'unknown',
          depth: 1,
          reason: 'no declaration',
          edgeId: null,
        },
      ],
    } satisfies FlowDetail;
    const g = buildFlow(flow, none, new Map([['l', [{ pkg: 'mongoose', line: 4 }]]]));
    expect(g.edges.map((e) => `${e.from}>${e.to}:${e.label}`)).toEqual([
      'step:0>step:1:handled by',
      'step:1>db:mongoose:calls (database?)',
      'step:1>step:2:not followed',
    ]);
    expect(g.nodes.find((n) => n.id === 'db:mongoose')).toMatchObject({
      provenance: 'pattern',
      kind: 'database',
    });
  });
});

describe('GraphCanvas', () => {
  it('selects with Enter, activates with a second Enter, and moves between nodes with arrows', () => {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    const nodes = [
      { id: 'a', label: 'routes', kind: 'module' as const, canDrill: true },
      { id: 'b', label: 'controllers', kind: 'module' as const },
    ];
    const edges = [{ id: 'e', from: 'a', to: 'b', label: 'imports ×1', provenance: 'verified' as const }];
    const { rerender } = render(
      <GraphCanvas
        label="Test"
        nodes={nodes}
        edges={edges}
        selectedId={null}
        onSelect={onSelect}
        onActivate={onActivate}
        resetKey="1"
      />,
    );
    const a = screen.getByRole('button', { name: /^routes, can open a level deeper/ });
    fireEvent.keyDown(a, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('a');
    rerender(
      <GraphCanvas
        label="Test"
        nodes={nodes}
        edges={edges}
        selectedId="a"
        onSelect={onSelect}
        onActivate={onActivate}
        resetKey="1"
      />,
    );
    expect(screen.getByRole('button', { name: /^routes/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(screen.getByRole('button', { name: /^routes/ }), { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledWith('a');
    fireEvent.keyDown(screen.getByRole('button', { name: /^routes/ }), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^controllers/ }));
    expect(screen.getByText('imports ×1')).toBeInTheDocument();
    expect(screen.getByText(/Arrows point to what is used/)).toBeInTheDocument();
  });
});
