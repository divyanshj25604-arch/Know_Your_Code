import { useEffect, useMemo, useState } from 'react';
import type { AnnotationView } from '@kyc/contracts';
import { FlowWalkthrough } from '../flows/FlowWalkthrough';
import { GraphCanvas, PROV_WORD, type Prov } from '../graph/GraphCanvas';
import { EmptyState, ErrorState, ProvenanceTag, Skeleton } from '../ui';
import {
  base,
  buildApplication,
  buildDependencies,
  buildFile,
  buildFlow,
  buildFunction,
  buildModule,
  DATABASE_PACKAGES,
  flowKey,
  nodeId,
  noteTarget,
  STEP_KIND,
  targetLocation,
  type Built,
  type Target,
} from './graphModel';
import { NotesPanel } from './Notes';
import { api } from '../../api/client';
import { queries } from '../../state/queryCache';
import {
  useArchitecture,
  useFileGraph,
  useFlow,
  useFlows,
  useOutline,
  useRelations,
  type Annotations,
} from './useExploreData';

export type GraphView = 'architecture' | 'dependencies' | 'functions' | 'flows';
export type Drill = { level: 'app' } | { level: 'module'; key: string } | { level: 'file'; path: string };

/** Where the code viewer is: the file, the declaration around the cursor or selection, and the line. */
export interface CodePlace {
  path: string | null;
  line: number | null;
  symbol: { id: string; key: string | null; name: string; line: number } | null;
}

const VIEWS: { id: GraphView; label: string }[] = [
  { id: 'architecture', label: 'Architecture' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'functions', label: 'Functions' },
  { id: 'flows', label: 'Request flows' },
];
const KINDS = [
  { id: 'imports', label: 'Imports' },
  { id: 'calls', label: 'Calls' },
  { id: 'uses', label: 'Uses and renders' },
  { id: 'packages', label: 'Packages' },
] as const;

const provTag = (p: Prov) => (
  <ProvenanceTag kind={p === 'unknown' ? 'unknown' : p === 'pattern' ? 'pattern' : 'verified'} />
);

/**
 * The centre of Explore: real graphs of the repository with progressive disclosure. Architecture drills from the
 * application's modules to a module's files to a file's functions; Dependencies centres one file; Functions centres one
 * function with its callers and callees; Request flows draws a request from route to response. Selecting a node or a
 * relationship opens its code; moving in the code selects the matching node. Notes attach to the selected entity.
 */
export function GraphPanel({
  snapshotId,
  commitSha,
  code,
  view,
  onView,
  drill,
  onDrill,
  flowId,
  onFlow,
  canNarrate,
  ann,
  onOpenTarget,
  onExplainTarget,
  onFlowGo,
  onOpenNote,
}: {
  snapshotId: string;
  commitSha: string | null;
  code: CodePlace;
  view: GraphView;
  onView: (v: GraphView) => void;
  drill: Drill;
  onDrill: (d: Drill) => void;
  flowId: string | null;
  onFlow: (id: string | null) => void;
  canNarrate: boolean;
  ann: Annotations;
  /** Open what a node or relationship stands for in the code viewer (and the explanation panel). */
  onOpenTarget: (t: Target) => void;
  /** Ask the AI about a function, a flow step or a relationship (its evidence line). */
  onExplainTarget: (t: Target) => void;
  onFlowGo: (path: string, line: number, label: string) => void;
  onOpenNote: (a: AnnotationView) => void;
}) {
  const arch = useArchitecture(snapshotId);
  const fg = useFileGraph(snapshotId);
  const flows = useFlows(snapshotId);
  const [kinds, setKinds] = useState<Set<string>>(() => new Set(['imports', 'calls', 'uses', 'packages']));
  const [showUnknown, setShowUnknown] = useState(true);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<{ id: string; stamp: string } | null>(null);
  const [pickedEdge, setPickedEdge] = useState<string | null>(null);
  const [tab, setTab] = useState<'details' | 'notes'>('details');
  const [depPin, setDepPin] = useState<string | null>(null);
  const [fnPin, setFnPin] = useState<string | null>(null);
  const [stepReq, setStepReq] = useState<{ index: number; n: number } | null>(null);
  const [step, setStep] = useState<number | null>(null);

  const stamp = `${code.path}|${code.line}|${code.symbol?.id ?? ''}`;

  // The file level follows the code: open another file and its functions are drawn.
  const filePath = drill.level === 'file' ? drill.path : null;
  useEffect(() => {
    if (view === 'architecture' && drill.level === 'file' && code.path && code.path !== drill.path)
      onDrill({ level: 'file', path: code.path });
  }, [code.path]);

  const depFocus = depPin ?? code.path;
  const fnFocus = fnPin ?? code.symbol?.id ?? null;
  const outline = useOutline(snapshotId, view === 'architecture' ? filePath : null);
  const rel = useRelations(view === 'functions' ? fnFocus : null);
  const flow = useFlow(view === 'flows' ? flowId : null);

  // Database calls of each flow step's own function, from the outlines of the step files (verified call edges).
  const [dbCalls, setDbCalls] = useState(new Map<string, { pkg: string; line: number }[]>());
  useEffect(() => {
    const f = flow.data;
    if (!f) return;
    const paths = [...new Set(f.steps.filter((s) => s.symbolId && s.path).map((s) => s.path!))];
    let live = true;
    Promise.all(
      paths.map((p) =>
        queries.get(`outline:${snapshotId}:${p}`, () => api.fileOutline(snapshotId, p)).catch(() => null),
      ),
    ).then((outs) => {
      if (!live) return;
      const m = new Map<string, { pkg: string; line: number }[]>();
      for (const o of outs)
        for (const e of o?.symbolEdges ?? [])
          if (e.from.symbolId && e.to.external && DATABASE_PACKAGES.has(e.to.external))
            m.set(e.from.symbolId, [...(m.get(e.from.symbolId) ?? []), { pkg: e.to.external, line: e.line }]);
      setDbCalls(m);
    });
    return () => {
      live = false;
    };
  }, [flow.data, snapshotId]);

  const notes = ann.count;
  const built: Built | null = useMemo(() => {
    if (view === 'architecture') {
      if (drill.level === 'app')
        return arch.data?.available ? buildApplication(arch.data, fg.data, notes) : null;
      if (drill.level === 'module')
        return arch.data && fg.data ? buildModule(arch.data, fg.data, drill.key, notes, kinds) : null;
      return outline.data && outline.data.path === drill.path
        ? buildFile(outline.data, notes, showUnknown)
        : null;
    }
    if (view === 'dependencies')
      return fg.data && depFocus ? buildDependencies(fg.data, depFocus, notes, kinds) : null;
    if (view === 'functions') return rel.data?.symbol ? buildFunction(rel.data, notes, showUnknown) : null;
    return flow.data ? buildFlow(flow.data, notes, dbCalls) : null;
  }, [
    view,
    drill,
    arch.data,
    fg.data,
    outline.data,
    rel.data,
    flow.data,
    depFocus,
    notes,
    kinds,
    showUnknown,
    dbCalls,
  ]);

  // Name filter: keep matching nodes and their direct neighbours, so a match is never shown cut off.
  const shown = useMemo(() => {
    if (!built) return null;
    const q = filter.trim().toLowerCase();
    const unknownOk = (id: string) => showUnknown || built.targets.get(id)?.kind !== 'unknown';
    let nodes = built.nodes.filter((n) => unknownOk(n.id));
    if (q) {
      const hit = new Set(
        nodes.filter((n) => `${n.label} ${n.sub ?? ''}`.toLowerCase().includes(q)).map((n) => n.id),
      );
      const keep = new Set(hit);
      for (const e of built.edges) {
        if (hit.has(e.from)) keep.add(e.to);
        if (hit.has(e.to)) keep.add(e.from);
      }
      nodes = nodes.filter((n) => keep.has(n.id));
    }
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: built.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
  }, [built, filter, showUnknown]);

  // Code → graph: the node for the declaration at the cursor, else the file, else its module, else a flow step there.
  const codeNode = useMemo(() => {
    if (!built) return null;
    const has = (id: string) => built.targets.has(id);
    if (view === 'flows' && step !== null && has(nodeId.step(step))) return nodeId.step(step);
    if (code.symbol && has(nodeId.symbol(code.symbol.id))) return nodeId.symbol(code.symbol.id);
    if (code.path && has(nodeId.file(code.path))) return nodeId.file(code.path);
    if (code.path && fg.data) {
      const m = fg.data.files.find((f) => f.path === code.path)?.module;
      if (m && has(nodeId.module(m))) return nodeId.module(m);
    }
    if (view === 'flows' && code.path)
      for (const [id, t] of built.targets)
        if (t.kind === 'step' && t.step.path === code.path && t.step.line === code.line) return id;
    return null;
  }, [built, code, fg.data, view, step]);
  const selectedId = picked && picked.stamp === stamp && built?.targets.has(picked.id) ? picked.id : codeNode;
  const selectedEdge = pickedEdge && built?.targets.has(pickedEdge) ? pickedEdge : null;
  const selTarget: Target | null =
    (selectedEdge ? built?.targets.get(selectedEdge) : null) ??
    (selectedId ? built?.targets.get(selectedId) : null) ??
    null;

  // Leave a pinned focus when the code moves somewhere the current graph doesn't show.
  useEffect(() => {
    if (depPin && code.path && built && !built.targets.has(nodeId.file(code.path))) setDepPin(null);
    if (fnPin && code.symbol && built && !built.targets.has(nodeId.symbol(code.symbol.id))) setFnPin(null);
  }, [stamp]);

  const select = (id: string) => {
    const t = built?.targets.get(id);
    if (!t) return;
    setPickedEdge(null);
    if (t.kind === 'step') {
      setStepReq((r) => ({ index: t.index, n: (r?.n ?? 0) + 1 }));
      setPicked({ id, stamp: '' });
      return;
    }
    const loc = targetLocation(t);
    // A pick holds until the code moves; a node that opens code is then found again from the code itself.
    setPicked({ id, stamp });
    if (loc && !(t.kind === 'file' && loc.path === code.path)) onOpenTarget(t);
  };

  const activate = (id: string) => {
    const t = built?.targets.get(id);
    if (!t) return;
    setFilter('');
    if (t.kind === 'module') onDrill({ level: 'module', key: t.key });
    else if (t.kind === 'file') {
      if (view === 'dependencies') setDepPin(t.path);
      else onDrill({ level: 'file', path: t.path });
      if (t.path !== code.path) onOpenTarget(t);
    } else if (t.kind === 'symbol' && t.id) {
      setFnPin(t.id);
      onView('functions');
      onOpenTarget(t);
    } else select(id);
  };

  const selectEdge = (id: string) => {
    const t = built?.targets.get(id);
    setPickedEdge(id);
    if (t) onOpenTarget(t);
  };

  // ------------------------------------------------------------------ header: views, level, filters
  const modName = (key: string) => arch.data?.modules.find((m) => m.key === key)?.name ?? key;
  const crumbs: { label: string; go?: () => void }[] =
    view === 'architecture'
      ? [
          { label: 'Application', ...(drill.level !== 'app' ? { go: () => onDrill({ level: 'app' }) } : {}) },
          ...(drill.level === 'module' ? [{ label: modName(drill.key) }] : []),
          ...(drill.level === 'file'
            ? (() => {
                const m = fg.data?.files.find((f) => f.path === drill.path)?.module;
                return [
                  ...(m ? [{ label: modName(m), go: () => onDrill({ level: 'module', key: m }) }] : []),
                  { label: base(drill.path) },
                ];
              })()
            : []),
        ]
      : [];

  const loading =
    (view === 'architecture' && (arch.loading || (drill.level !== 'app' && fg.loading) || outline.loading)) ||
    (view === 'dependencies' && fg.loading) ||
    (view === 'functions' && rel.loading) ||
    (view === 'flows' && (flows.loading || flow.loading));
  const error =
    (view === 'architecture' &&
      (arch.error ?? (drill.level === 'module' ? fg.error : null) ?? outline.error)) ||
    (view === 'dependencies' && fg.error) ||
    (view === 'functions' && rel.error) ||
    (view === 'flows' && (flows.error ?? flow.error)) ||
    null;
  const retry = () => {
    arch.retry();
    fg.retry();
    outline.retry();
    rel.retry();
    flows.retry();
    flow.retry();
  };

  const empty = (() => {
    if (loading || error || (shown && shown.nodes.length > 0)) return null;
    if (view === 'architecture' && drill.level === 'app' && arch.data && !arch.data.available)
      return (
        <EmptyState title="No architecture map for this snapshot">
          It was analysed before module detection existed. Import the repository again to see its map, or use
          Dependencies.
        </EmptyState>
      );
    if (view === 'architecture' && drill.level === 'file')
      return (
        <EmptyState title={`No functions or classes in ${base(drill.path)}`}>
          The analysis found no declarations here. It may be configuration, data, or a file that wasn't
          analysed.
        </EmptyState>
      );
    if (view === 'dependencies' && !depFocus)
      return (
        <EmptyState title="Choose a file">
          Open a file, or select one in Architecture, to see what it imports and what depends on it.
        </EmptyState>
      );
    if (view === 'dependencies')
      return (
        <EmptyState title="No connections found">
          The analysis found no imports or calls between {base(depFocus!)} and other analysed files.
        </EmptyState>
      );
    if (view === 'functions')
      return (
        <EmptyState title="Choose a function">
          Put the cursor inside a function in the code, or select one in the graph, to see what calls it and
          what it calls.
        </EmptyState>
      );
    if (view === 'flows' && !flowId) return null;
    return <p className="small muted">Nothing to draw here.</p>;
  })();

  const resetKey = `${view}|${JSON.stringify(drill)}|${depFocus}|${fnFocus}|${flowId}|${kinds.size}|${showUnknown}`;
  const nt = selTarget ? noteTarget(selTarget) : null;
  const connections =
    selectedId && shown && !selectedEdge
      ? shown.edges
          .filter((e) => e.from === selectedId || e.to === selectedId)
          .map((e) => ({ e, other: e.from === selectedId ? e.to : e.from, out: e.from === selectedId }))
      : [];
  const labelOf = (id: string) => shown?.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <section className="graph-panel" aria-label="Graph">
      <div className="graph-toolbar">
        <div className="seg" role="tablist" aria-label="Graph view">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className="seg-btn"
              onClick={() => {
                setFilter('');
                onView(v.id);
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
        <input
          className="graph-filter"
          type="search"
          aria-label="Find in graph"
          placeholder="Find in graph"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="graph-sub">
        {view === 'architecture' && (
          <nav aria-label="Graph level" className="graph-crumbs">
            {crumbs.map((c, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden="true"> › </span>}
                {c.go ? (
                  <button type="button" className="link" onClick={c.go}>
                    {c.label}
                  </button>
                ) : (
                  <span aria-current="location">{c.label}</span>
                )}
              </span>
            ))}
            {drill.level !== 'app' && (
              <button
                type="button"
                className="btn btn-small btn-quiet"
                onClick={() =>
                  onDrill(
                    drill.level === 'file'
                      ? (() => {
                          const m = fg.data?.files.find((f) => f.path === drill.path)?.module;
                          return m ? { level: 'module', key: m } : { level: 'app' };
                        })()
                      : { level: 'app' },
                  )
                }
              >
                ↑ Up a level
              </button>
            )}
          </nav>
        )}
        {view === 'dependencies' && depFocus && (
          <p className="small">
            Centred on <span className="mono">{depFocus}</span>
            {depPin && (
              <>
                {' '}
                <button type="button" className="link small" onClick={() => setDepPin(null)}>
                  Follow the code
                </button>
              </>
            )}
          </p>
        )}
        {view === 'functions' && rel.data?.symbol && (
          <p className="small">
            Centred on <span className="mono">{rel.data.symbol.name}()</span>
            {fnPin && (
              <>
                {' '}
                <button type="button" className="link small" onClick={() => setFnPin(null)}>
                  Follow the code
                </button>
              </>
            )}
          </p>
        )}
        {view === 'flows' && (
          <label className="small row">
            <span>Flow</span>
            <select
              value={flowId ?? ''}
              onChange={(e) => onFlow(e.target.value || null)}
              aria-label="Request flow"
              disabled={!flows.data?.flows.length}
            >
              <option value="">
                {flows.data?.flows.length ? 'Choose a request flow…' : 'No request flows found'}
              </option>
              {flows.data?.flows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.unknownCount ? ` (${f.unknownCount} not followed)` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {view !== 'flows' && !(view === 'architecture' && drill.level === 'app') && (
          <fieldset className="graph-kinds">
            <legend className="sr-only">Relationships to show</legend>
            {KINDS.filter(
              (k) =>
                !(view === 'functions' && k.id === 'packages') &&
                !(view === 'architecture' && drill.level === 'file' && k.id === 'packages'),
            ).map((k) => (
              <label key={k.id} className="graph-check">
                <input
                  type="checkbox"
                  checked={kinds.has(k.id)}
                  onChange={(e) =>
                    setKinds((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(k.id);
                      else n.delete(k.id);
                      return n;
                    })
                  }
                  disabled={view === 'functions' || (view === 'architecture' && drill.level === 'file')}
                />
                {k.label}
              </label>
            ))}
            <label className="graph-check">
              <input
                type="checkbox"
                checked={showUnknown}
                onChange={(e) => setShowUnknown(e.target.checked)}
              />
              Not sure
            </label>
          </fieldset>
        )}
      </div>

      <div className="graph-stage">
        {loading && (
          <div className="graph-state" role="status">
            <Skeleton lines={4} />
            <span className="sr-only">Loading the graph…</span>
          </div>
        )}
        {error && !loading && (
          <div className="graph-state">
            <ErrorState code={error.code} message={error.message} onAction={retry} actionLabel="Try again" />
          </div>
        )}
        {empty && <div className="graph-state">{empty}</div>}
        {view === 'flows' && !flowId && !loading && !error && (
          <div className="graph-state">
            <EmptyState title="Follow a request through the code">
              {flows.data?.flows.length ? (
                <>
                  Choose a request flow above. Each step opens its code, and steps the analysis couldn't
                  follow say why.
                  <ul className="bare-list stack flow-picks">
                    {flows.data.flows.slice(0, 6).map((f) => (
                      <li key={f.id}>
                        <button type="button" className="code-cite" onClick={() => onFlow(f.id)}>
                          <span>{f.name}</span>
                          {f.handler && (
                            <span className="path">
                              {f.handler.path}:{f.handler.line}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                'No HTTP routes were recognised in this repository, so there are no request flows to draw.'
              )}
            </EmptyState>
          </div>
        )}
        {shown && shown.nodes.length > 0 && !loading && !error && (
          <GraphCanvas
            label={`${VIEWS.find((v) => v.id === view)!.label} graph`}
            nodes={shown.nodes}
            edges={shown.edges}
            selectedId={selectedId}
            selectedEdgeId={selectedEdge}
            onSelect={select}
            onActivate={activate}
            onSelectEdge={selectEdge}
            direction={view === 'flows' ? 'TB' : 'auto'}
            {...(built?.fixedRank ? { fixedRank: built.fixedRank } : {})}
            resetKey={resetKey}
          />
        )}
        {built?.omitted && <p className="graph-omitted small muted">{built.omitted}</p>}
      </div>

      <div className="graph-detail">
        <div className="seg seg-small" role="tablist" aria-label="Selection">
          <button
            type="button"
            role="tab"
            className="seg-btn"
            aria-selected={tab === 'details'}
            onClick={() => setTab('details')}
          >
            {view === 'flows' && flowId ? 'Walkthrough' : 'Details'}
          </button>
          <button
            type="button"
            role="tab"
            className="seg-btn"
            aria-selected={tab === 'notes'}
            onClick={() => setTab('notes')}
          >
            Notes{nt && ann.count(nt.key) ? ` (${ann.count(nt.key)})` : ''}
          </button>
        </div>
        <div className="graph-detail-body">
          {tab === 'notes' && <NotesPanel ann={ann} target={nt} commitSha={commitSha} onOpen={onOpenNote} />}
          {tab === 'details' && view === 'flows' && flowId && (
            <FlowWalkthrough
              key={flowId}
              flowId={flowId}
              canNarrate={canNarrate}
              onGo={onFlowGo}
              onClose={() => onFlow(null)}
              request={stepReq}
              onStep={(i) => {
                setStep(i);
                setPicked({ id: nodeId.step(i), stamp: '' });
              }}
            />
          )}
          {tab === 'details' && !(view === 'flows' && flowId) && (
            <Details
              t={selTarget}
              connections={connections}
              labelOf={labelOf}
              onSelect={select}
              onSelectEdge={selectEdge}
              onOpen={onOpenTarget}
              onExplain={onExplainTarget}
              onDrill={activate}
              selectedId={selectedId}
              view={view}
              onDeps={(p) => {
                setDepPin(p === code.path ? null : p);
                onView('dependencies');
              }}
              onNote={() => setTab('notes')}
              canNote={!!nt && ann.status === 'ready'}
            />
          )}
          {tab === 'details' && view === 'flows' && flowId && flow.data && (
            <p className="small muted">
              Flow <span className="mono">{flowKey(flow.data)}</span>: {flow.data.steps.length} steps
              {flow.data.unknownCount ? `, ${flow.data.unknownCount} not followed` : ''}.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Details({
  t,
  connections,
  labelOf,
  onSelect,
  onSelectEdge,
  onOpen,
  onExplain,
  onDrill,
  selectedId,
  view,
  onDeps,
  onNote,
  canNote,
}: {
  t: Target | null;
  connections: { e: { id: string; label: string; provenance: Prov }; other: string; out: boolean }[];
  labelOf: (id: string) => string;
  onSelect: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onOpen: (t: Target) => void;
  onExplain: (t: Target) => void;
  onDrill: (id: string) => void;
  selectedId: string | null;
  view: GraphView;
  onDeps: (path: string) => void;
  onNote: () => void;
  canNote: boolean;
}) {
  if (!t)
    return (
      <p className="small muted">
        Select a node to see its connections and open its code. Select it again (or press <kbd>Enter</kbd>) to
        go a level deeper. Select a line between nodes to see the relationship and its evidence.
      </p>
    );
  const loc = targetLocation(t);
  const title =
    t.kind === 'module'
      ? `Module ${t.name}`
      : t.kind === 'file'
        ? t.path
        : t.kind === 'symbol'
          ? `${t.name}()`
          : t.kind === 'package'
            ? t.name
            : t.kind === 'step'
              ? `${STEP_KIND[t.step.kind]}: ${t.step.label}`
              : t.label;
  const prov: Prov | null =
    t.kind === 'relation'
      ? t.provenance
      : t.kind === 'step'
        ? t.step.provenance
        : t.kind === 'unknown'
          ? 'unknown'
          : t.kind === 'package'
            ? t.database
              ? 'pattern'
              : null
            : 'verified';
  return (
    <div className="details" aria-live="polite">
      <p className="row">
        <strong className={t.kind === 'file' || t.kind === 'symbol' ? 'mono' : ''}>{title}</strong>
        {prov && provTag(prov)}
      </p>
      {t.kind === 'relation' && (
        <p className="small">
          Evidence:{' '}
          <span className="mono">
            {t.path}:{t.line}
          </span>
          . {PROV_WORD[t.provenance]}:{' '}
          {t.provenance === 'verified'
            ? 'the parser resolved this relationship.'
            : 'matched by a known pattern, not proved by the parser.'}
        </p>
      )}
      {t.kind === 'package' && (
        <p className="small">
          {t.database
            ? 'A database client, judged by its name: the calls into it are verified, that they reach a database is likely.'
            : 'An npm package your code calls. Its own code is not part of this analysis.'}
        </p>
      )}
      {t.kind === 'unknown' && <p className="small">Why: {t.reason}.</p>}
      {t.kind === 'step' && t.step.reason && <p className="small">Why: {t.step.reason}.</p>}
      {t.kind === 'module' && (
        <p className="small">
          Folder <span className="mono">{t.root || '/'}</span>.
        </p>
      )}
      {loc && (
        <button type="button" className="code-cite" onClick={() => onOpen(t)}>
          <span>Open the code</span>
          <span className="path">
            {loc.path}:{loc.line}
          </span>
        </button>
      )}
      <div className="row details-actions">
        {(t.kind === 'module' || (t.kind === 'file' && view === 'architecture')) && selectedId && (
          <button type="button" className="btn btn-small" onClick={() => onDrill(selectedId)}>
            {t.kind === 'module' ? 'Show its files' : 'Show its functions'}
          </button>
        )}
        {t.kind === 'file' && view !== 'dependencies' && (
          <button type="button" className="btn btn-small" onClick={() => onDeps(t.path)}>
            Show dependencies
          </button>
        )}
        {t.kind === 'symbol' && t.id && view !== 'functions' && selectedId && (
          <button type="button" className="btn btn-small" onClick={() => onDrill(selectedId)}>
            Show callers and callees
          </button>
        )}
        {(t.kind === 'symbol' || t.kind === 'relation' || (t.kind === 'step' && t.step.path)) && (
          <button type="button" className="btn btn-small" onClick={() => onExplain(t)}>
            {t.kind === 'relation' ? 'Explain this connection' : 'Explain with AI'}
          </button>
        )}
        {canNote && (
          <button type="button" className="btn btn-small btn-quiet" onClick={onNote}>
            Add a note
          </button>
        )}
      </div>
      {connections.length > 0 && (
        <div>
          <h3 className="small">Connections ({connections.length})</h3>
          <ul className="bare-list conn-list">
            {connections.slice(0, 20).map(({ e, other, out }) => (
              <li key={e.id}>
                <button type="button" className="link small" onClick={() => onSelectEdge(e.id)}>
                  {out ? `${e.label} →` : `← ${e.label}`}
                </button>{' '}
                <button type="button" className="link small mono" onClick={() => onSelect(other)}>
                  {labelOf(other)}
                </button>{' '}
                <span className="small muted">({PROV_WORD[e.provenance]})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
