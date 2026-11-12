import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Depth, PathsView, Selection, SnapshotView, TourView } from '@kyc/contracts';
import { api, ApiError } from '../api/client';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { CodeViewer, type Anchor, type ViewerHandle } from '../components/CodeViewer';
import { ExplanationPanel } from '../components/ExplanationPanel';
import { FileTree } from '../components/FileTree';
import { RepoMenu } from '../components/RepoMenu';
import { AiStatusBanner, Header, useHealth } from '../components/Shell';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';
import { useDepth } from '../hooks/usePrefs';
import { useLearnGuide, usePaths, useTour } from '../hooks/useLearning';
import { useWorkspace, type Workspace as WorkspaceState } from '../hooks/useWorkspace';
import { MODES, ModeNav, type Mode } from '../components/modes/ModeNav';
import { ProjectMode } from '../components/modes/ProjectMode';
import { ValidateMode } from '../components/modes/ValidateMode';
import { BookmarkButton, Bookmarks } from '../components/learning/Bookmarks';
import { TourBar } from '../components/learning/TourBar';
import { ArchitectureMap } from '../components/learning/ArchitectureMap';
import { Concepts } from '../components/learning/Concepts';
import { FlowList } from '../components/flows/FlowList';
import { PathList, PathPlayer } from '../components/learning/PathPlayer';
import { GraphPanel, type CodePlace, type Drill, type GraphView } from '../components/explore/GraphPanel';
import { FileExplanation } from '../components/explore/FileExplanation';
import { ProjectMap } from '../components/explore/ProjectMap';
import { useAnnotations, useFileGraph, useFlows, useOutline } from '../components/explore/useExploreData';
import { STEP_KIND, type Target } from '../components/explore/graphModel';
import { queries } from '../state/queryCache';
import { repoName } from '../lib/repoName';

export function Workspace() {
  const { id = '', mode: rawMode } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const health = useHealth();
  const [depth, setDepth] = useDepth();
  const [snap, setSnap] = useState<SnapshotView | null>(null);
  const [snapError, setSnapError] = useState<ApiError | null>(null);
  const initial = useRef({
    path: params.get('path'),
    line: params.get('line') ? Number(params.get('line')) : null,
    // A read-only share link (/r/:id?share=…). Captured once: later URL updates (path, line) must not drop it.
    share: params.get('share'),
  });

  useEffect(() => {
    api.setShareToken(initial.current.share);
    return () => api.setShareToken(null);
  }, []);

  useEffect(() => {
    api
      .snapshot(id)
      .then(setSnap)
      .catch((e) =>
        setSnapError(
          e instanceof ApiError ? e : new ApiError('SERVICE_UNAVAILABLE', 'Something went wrong.', true, 0),
        ),
      );
  }, [id]);

  // /r/:id opens the project page (Journey A: overview and a next step first). A deep link to code (?path=) opens
  // Explore, keeping its parameters, so existing share and deep links still land on the code.
  if (!MODES.includes(rawMode as Mode)) {
    const to = params.get('path') ? 'explore' : 'project';
    return <Navigate to={`/r/${id}/${to}${location.search}`} replace />;
  }
  const mode = rawMode as Mode;

  if (snapError)
    return (
      <ErrorShell>
        <ErrorState
          code={snapError.code}
          message={snapError.message}
          onAction={() => nav('/start')}
          actionLabel="Open another repository"
        />
      </ErrorShell>
    );
  if (snap && (snap.status === 'failed' || snap.status === 'expired')) {
    return (
      <ErrorShell>
        <ErrorState
          code={
            snap.status === 'expired' ? 'SNAPSHOT_EXPIRED' : ((snap.error?.code as never) ?? 'INDEX_FAILED')
          }
          message={snap.error?.message}
          onAction={() => nav('/start')}
          actionLabel="Import again"
        />
      </ErrorShell>
    );
  }
  if (snap && snap.status !== 'ready' && snap.status !== 'ready_partial') {
    nav(`/r/${id}/processing`, { replace: true });
    return null;
  }
  if (!snap)
    return (
      <ErrorShell>
        <p className="muted" role="status">
          Opening the repository…
        </p>
        <Skeleton lines={5} />
      </ErrorShell>
    );

  return (
    <Loaded
      key={id}
      snap={snap}
      mode={mode}
      depth={depth}
      setDepth={setDepth}
      health={health}
      initial={initial.current}
      onUrl={(path, line) =>
        setParams(path ? { path, ...(line ? { line: String(line) } : {}) } : {}, { replace: true })
      }
      onDeleted={() => nav('/', { replace: true })}
    />
  );
}

/**
 * Explore (PRD stage 5): code and "What this file does" on the left, the graph in the centre, the explanation (AI) on
 * the right, all one environment. A node chosen in the graph opens and highlights its code and gives the explanation
 * panel that context; moving the cursor in the code selects the matching node.
 */
function ExploreBody({
  snap,
  ws,
  depth,
  setDepth,
  onUrl,
  bookmarkTarget,
  readOnly,
  view,
  onView,
  drill,
  onDrill,
  flowId,
  onFlow,
  actions,
}: {
  snap: SnapshotView;
  ws: WorkspaceState;
  depth: Depth;
  setDepth: (d: Depth) => void;
  onUrl: (path: string | null, line: number | null) => void;
  bookmarkTarget: { repositoryId: string; commitSha: string | null };
  readOnly: boolean;
  view: GraphView;
  onView: (v: GraphView) => void;
  drill: Drill;
  onDrill: (d: Drill) => void;
  flowId: string | null;
  onFlow: (id: string | null) => void;
  actions: ReactNode;
}) {
  const entry = ws.entry;
  const path = entry?.path ?? null;
  const outline = useOutline(snap.id, path);
  const fg = useFileGraph(snap.id);
  const flows = useFlows(snap.id);
  const ann = useAnnotations(snap.repositoryId, readOnly);
  const [cursor, setCursor] = useState<{ entryId: string; line: number } | null>(null);

  // Where the code is, for the graph: the declaration opened from a relation or node, else the innermost declaration
  // around the cursor the user placed, else the declaration an explanation is about.
  const code: CodePlace = (() => {
    if (!entry) return { path: null, line: null, symbol: null };
    if (entry.relationSymbolId)
      return {
        path,
        line: entry.line,
        symbol: {
          id: entry.relationSymbolId,
          key: entry.relations?.symbol?.key ?? null,
          name: entry.relations?.symbol?.name ?? entry.label,
          line: entry.line,
        },
      };
    const at = cursor && cursor.entryId === entry.id ? cursor.line : null;
    if (at !== null && outline.data?.path === path) {
      const inner = outline.data.symbols
        .filter(
          (x) => x.startLine <= at && x.endLine >= at && x.kind !== 'parameter' && x.kind !== 'variable',
        )
        .sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];
      return {
        path,
        line: at,
        symbol: inner ? { id: inner.id, key: inner.key, name: inner.name, line: inner.startLine } : null,
      };
    }
    const es = entry.expl?.relations?.symbol;
    return {
      path,
      line: entry.line,
      symbol: es && es.path === path ? { id: es.id, key: es.key, name: es.name, line: es.startLine } : null,
    };
  })();

  const openTarget = (t: Target) => {
    if (t.kind === 'file') ws.openFile(t.path);
    else if (t.kind === 'symbol') ws.navigate(t.path, t.line, t.name, t.id ?? undefined);
    else if (t.kind === 'step' && t.step.path && t.step.line)
      ws.navigate(
        t.step.path,
        t.step.line,
        `${STEP_KIND[t.step.kind]}: ${t.step.label}`,
        t.step.symbolId ?? undefined,
      );
    else if ((t.kind === 'relation' || t.kind === 'unknown') && t.path && t.line)
      ws.navigate(t.path, t.line, t.label);
  };

  /** Explain one line of code (a relationship's evidence) through the normal explanation pipeline. */
  const explainLine = async (p: string, line: number) => {
    try {
      const f = await queries.get(`file:${snap.id}:${p}`, () => api.file(snap.id, p));
      const text = f.content.split('\n')[line - 1] ?? '';
      if (!text.trim()) return ws.navigate(p, line, `${p.split('/').pop()}:${line}`);
      const indent = text.length - text.trimStart().length;
      await ws.explain(
        { path: p, startLine: line, startCol: indent, endLine: line, endCol: text.length },
        text.trim(),
        depth,
      );
    } catch {
      ws.navigate(p, line, `${p.split('/').pop()}:${line}`);
    }
  };
  const explainTarget = async (t: Target) => {
    const symbolId = t.kind === 'symbol' ? t.id : t.kind === 'step' ? t.step.symbolId : null;
    if (symbolId) {
      try {
        const rel = await queries.get(`relations:${symbolId}`, () => api.relations(symbolId));
        await ws.explainSymbol(rel, depth);
        return;
      } catch {
        /* fall through to the line */
      }
    }
    const loc =
      t.kind === 'step'
        ? t.step.path && t.step.line
          ? { path: t.step.path, line: t.step.line }
          : null
        : t.kind === 'symbol' || t.kind === 'relation' || t.kind === 'unknown'
          ? t.path && t.line
            ? { path: t.path, line: t.line }
            : null
          : null;
    if (loc) await explainLine(loc.path, loc.line);
  };

  return (
    <WorkspaceView
      ws={ws}
      depth={depth}
      setDepth={setDepth}
      onUrl={onUrl}
      bookmarkTarget={bookmarkTarget}
      onCursor={(line) => entry && setCursor({ entryId: entry.id, line })}
      graph={
        <GraphPanel
          snapshotId={snap.id}
          commitSha={snap.commitSha}
          code={code}
          view={view}
          onView={onView}
          drill={drill}
          onDrill={onDrill}
          flowId={flowId}
          onFlow={onFlow}
          canNarrate={!readOnly}
          ann={ann}
          onOpenTarget={openTarget}
          onExplainTarget={(t) => void explainTarget(t)}
          onFlowGo={(p, l, label) => ws.navigate(p, l, label)}
          onOpenNote={(a) => {
            if (a.targetKind === 'module') onDrill({ level: 'module', key: a.targetKey });
            if (a.path) ws.navigate(a.path, a.startLine ?? 1, a.targetLabel);
          }}
        />
      }
      fileExpl={
        <FileExplanation
          path={path}
          outline={outline.data}
          outlineError={outline.error}
          onRetry={outline.retry}
          fileGraph={fg.data}
          flows={flows.data}
          currentSymbolId={code.symbol?.id ?? null}
          onOpen={(p, l, label) => ws.navigate(p, l, label)}
          onSymbol={(x) => ws.navigate(path!, x.startLine, x.name, x.id)}
          onWalk={onFlow}
        />
      }
      empty={() => (
        <ExploreStart ws={ws} snapshotId={snap.id} repositoryId={snap.repositoryId} onWalk={onFlow} />
      )}
      actions={actions}
    />
  );
}

function ErrorShell({ children }: { children: ReactNode }) {
  return (
    <div className="page">
      <Header />
      <main className="narrow" id="main">
        {children}
        <p>
          <Link to="/">← Home</Link>
        </p>
      </main>
    </div>
  );
}

/**
 * One workspace track's screen (Learn and Explore): the trail bar, then three columns. Left: the guide (Learn home,
 * learning path, tour or flow walkthrough) or, when there is no guide, the file tree; with a guide, files open as a
 * drawer. Centre: always the code. Right: always the explanation. A code reference clicked anywhere opens in the
 * centre and is highlighted the same way.
 */
function WorkspaceView({
  ws,
  depth,
  setDepth,
  onUrl,
  actions,
  guide,
  empty,
  bookmarkTarget,
  graph,
  fileExpl,
  onCursor,
}: {
  ws: WorkspaceState;
  depth: Depth;
  setDepth: (d: Depth) => void;
  /** Keep the URL shareable (Explore only). */
  onUrl?: (path: string | null, line: number | null) => void;
  /** Mode-specific controls shown in the trail bar. */
  actions?: ReactNode;
  /**
   * The left-column guide. As a function it receives the place the learner is at in the code (the viewer cursor, or
   * the current stop).
   */
  guide?: ReactNode | ((place: () => { path: string; line: number } | null) => ReactNode);
  /** Shown in the centre when no code is open. */
  empty?: (ctx: { openFiles: () => void }) => ReactNode;
  /** Where bookmarks are saved; absent when bookmarking is not possible. */
  bookmarkTarget?: { repositoryId: string; commitSha: string | null };
  /**
   * Explore's layout: code above "What this file does" on the left, this graph in the centre (the largest area), the
   * explanation on the right. Files open as a drawer.
   */
  graph?: ReactNode;
  fileExpl?: ReactNode;
  /** The user moved the cursor in the code (code → graph). */
  onCursor?: (line: number) => void;
}) {
  const viewer = useRef<ViewerHandle>(null);
  const [anchor, setAnchor] = useState<{ sel: Selection & { text?: string }; at: Anchor } | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const entry = ws.entry;

  // Keep the URL shareable (FR-NAV-03).
  useEffect(() => {
    onUrl?.(entry?.path ?? null, entry?.line ?? null);
  }, [entry?.path, entry?.line]);

  const explainCurrent = useCallback(() => {
    const s = viewer.current?.getSelection();
    if (!s) return;
    const { text, ...sel } = s;
    setAnchor(null);
    setSheet(true);
    void ws.explain(sel, text, depth);
  }, [ws.explain, depth]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) &&
        !t.closest('.cm-editor');
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        ws.back();
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        ws.forward();
      } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 't' || e.key === 'T') {
          if (!t?.closest('.cm-editor')) setTreeOpen((o) => !o);
        } else if (e.key === 'Escape') {
          if (t?.closest('dialog')) return;
          setSheet(false);
          setTreeOpen(false);
          setAnchor(null);
          viewer.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [ws]);

  // Open a line reference from the panel in the viewer, as a new stop in the trail.
  const openRef = useCallback(
    (path: string, line: number) => ws.navigate(path, line, `${path.split('/').pop()}:${line}`),
    [ws],
  );

  // The code an explanation is about, or the whole declaration opened from a relation or a graph node.
  const relSym = entry?.relations?.symbol;
  const markRange =
    entry?.expl?.selection ??
    (relSym && relSym.path === entry?.path
      ? { path: relSym.path, startLine: relSym.startLine, startCol: 0, endLine: relSym.endLine, endCol: 0 }
      : null);
  const fileData = ws.file.data;
  const guideNode =
    typeof guide === 'function'
      ? guide(() => {
          const s = viewer.current?.getSelection();
          if (s) return { path: s.path, line: s.startLine };
          return entry?.path && entry.line ? { path: entry.path, line: entry.line } : null;
        })
      : guide;
  const hasGuide = Boolean(guideNode);
  const explore = Boolean(graph);
  const drawer = hasGuide || explore;

  return (
    <>
      <div className={`subbar${drawer ? ' has-guide' : ''}${explore ? ' explore-bar' : ''}`}>
        <button
          type="button"
          className="btn btn-small tree-toggle"
          aria-expanded={treeOpen}
          onClick={() => setTreeOpen(!treeOpen)}
          title="Files (T)"
        >
          Files
        </button>
        <Breadcrumbs
          entries={ws.entries}
          index={ws.index}
          onJump={ws.goTo}
          onBack={ws.back}
          onForward={ws.forward}
          canForward={ws.canForward}
        />
        <div className="subbar-actions">
          {actions}
          <button
            type="button"
            className="btn btn-small sheet-toggle"
            aria-expanded={sheet}
            onClick={() => setSheet(!sheet)}
          >
            Explanation
          </button>
        </div>
      </div>

      <div
        className={`workspace${hasGuide ? ' has-guide' : ''}${explore ? ' explore-layout' : ''}${treeOpen ? ' tree-open' : ''}${sheet ? ' sheet-open' : ''}`}
      >
        {hasGuide && <div className="ws-guide">{guideNode}</div>}
        <button
          type="button"
          className="drawer-scrim"
          aria-label="Close files"
          tabIndex={-1}
          onClick={() => setTreeOpen(false)}
        />
        <div className="ws-tree">
          {ws.tree ? (
            <FileTree
              root={ws.tree}
              activePath={entry?.path ?? null}
              onOpen={(p) => {
                ws.openFile(p);
                setTreeOpen(false);
              }}
            />
          ) : ws.loadError ? (
            <ErrorState code={ws.loadError.code} message={ws.loadError.message} />
          ) : (
            <Skeleton lines={8} />
          )}
        </div>

        <main className="ws-viewer" id="main">
          {ws.loadError && <ErrorState code={ws.loadError.code} message={ws.loadError.message} />}
          {ws.selectionError && (
            <p className="note" role="alert">
              {ws.selectionError}{' '}
              <button type="button" className="link" onClick={ws.clearSelectionError}>
                Dismiss
              </button>
            </p>
          )}
          {!entry && (ws.loading ? <Skeleton lines={6} /> : empty?.({ openFiles: () => setTreeOpen(true) }))}
          {entry && ws.file.status === 'loading' && <Skeleton lines={10} />}
          {entry && ws.file.status === 'error' && ws.file.error && (
            <ErrorState
              code={ws.file.error.code}
              message={ws.file.error.message}
              onAction={() => ws.goTo(Math.max(0, ws.index - 1))}
              actionLabel="Back"
            />
          )}
          {entry && fileData && ws.file.status === 'ready' && (
            <div className="viewer-wrap">
              <div className="viewer-head">
                <span className="mono" title={fileData.path}>
                  {fileData.path}
                </span>
                {!fileData.analysable && (
                  <span className="tag tag-warn" title="Shown for reading; no verified relations.">
                    not analysed
                  </span>
                )}
                {fileData.generated && <span className="tag tag-warn">generated</span>}
                <span className="viewer-tools">
                  {bookmarkTarget && (
                    <BookmarkButton
                      repositoryId={bookmarkTarget.repositoryId}
                      commitSha={bookmarkTarget.commitSha}
                      stop={{
                        path: fileData.path,
                        startLine: entry.expl?.selection.startLine ?? entry.line,
                        endLine: entry.expl?.selection.endLine ?? entry.line,
                        symbolKey: entry.expl?.relations?.symbol?.key ?? entry.relations?.symbol?.key ?? null,
                        label: entry.label,
                      }}
                    />
                  )}
                  <button
                    type="button"
                    className="btn btn-small btn-quiet"
                    onClick={() => viewer.current?.focus()}
                    aria-label="Focus the code"
                  >
                    Focus code
                  </button>
                </span>
              </div>
              {fileData.truncated && (
                <p className="note">Showing the first 2,000 of {fileData.lines.toLocaleString()} lines.</p>
              )}
              <CodeViewer
                ref={viewer}
                path={fileData.path}
                content={fileData.content}
                language={fileData.language}
                targetLine={entry.line}
                markRange={markRange}
                scrollKey={entry.id}
                onSelect={(sel, at) => setAnchor(sel && at ? { sel, at } : null)}
                onExplainKey={explainCurrent}
                {...(onCursor ? { onCursor } : {})}
              />
            </div>
          )}
          {anchor && (
            <button
              type="button"
              className="btn btn-primary float-explain"
              style={{
                left: Math.max(8, Math.min(anchor.at.x, window.innerWidth - 120)),
                top: anchor.at.y + 8,
              }}
              onClick={explainCurrent}
            >
              Explain <kbd>E</kbd>
            </button>
          )}
        </main>
        {explore && <div className="ws-fexpl">{fileExpl}</div>}
        {explore && <div className="ws-graph">{graph}</div>}

        <div className="ws-panel">
          <button type="button" className="sheet-close btn btn-small" onClick={() => setSheet(false)}>
            Close
          </button>
          <ExplanationPanel ws={ws} depth={depth} onDepth={setDepth} onOpenRef={openRef} />
        </div>
      </div>
    </>
  );
}

/** Whether this track's place is being saved to the server (so a reload or another device resumes it). */
function SaveStatus({ ws }: { ws: WorkspaceState }) {
  if (ws.persistence === 'error')
    return (
      <span className="status status-error" role="status">
        <span className="glyph" aria-hidden="true">
          ✕
        </span>
        Couldn't save your place
      </span>
    );
  if (ws.persistence === 'saving')
    return (
      <span className="status status-progress" role="status">
        <span className="glyph" aria-hidden="true">
          ◐
        </span>
        Saving your place…
      </span>
    );
  if (ws.persistence === 'saved' && ws.entry)
    return (
      <span className="status status-success" role="status">
        <span className="glyph" aria-hidden="true">
          ✓
        </span>
        Place saved
      </span>
    );
  return null;
}

/** The Learn home in the guide column: continue, learning paths, the tour, or learn at your own pace. */
function LearnHome({
  learning,
  paths,
  pathsError,
  tour,
  onStartPath,
  onStartTour,
}: {
  learning: WorkspaceState;
  paths: PathsView | null;
  pathsError: boolean;
  tour: TourView | null;
  onStartPath: (id: string) => void;
  onStartTour: () => void;
}) {
  return (
    <section className="guide" aria-label="Learn">
      <div className="guide-head">
        <div>
          <span className="eyebrow">Learn</span>
          <h2>What do you want to learn?</h2>
        </div>
      </div>
      {learning.entry && (
        <div className="guide-card">
          <span className="eyebrow">Where you left off</span>
          <p>
            <span className="mono">{learning.entry.label}</span>
          </p>
          <p className="small muted">
            The code is open beside this. Select any part of it to explain it, or pick a path below.
          </p>
        </div>
      )}
      <div className="guide-block">
        <h3>Learning paths</h3>
        <PathList view={paths} error={pathsError} onOpen={onStartPath} headingLevel={3} />
      </div>
      {tour && tour.stops.length > 0 && (
        <div className="guide-block">
          <h3>Guided tour</h3>
          <p className="small muted">
            {tour.stops.length} stops through the most important code, in order, each with the reason it
            matters.
          </p>
          <button type="button" className="btn btn-small" onClick={onStartTour}>
            Take the guided tour
          </button>
        </div>
      )}
      <div className="guide-block">
        <h3>At your own pace</h3>
        <p className="small muted">
          Open any file (Files, or press <kbd>T</kbd>), select code, and press <kbd>E</kbd> to explain it.
          Your place is saved as you go.
        </p>
      </div>
    </section>
  );
}

/** Explore's start page (no code open yet): real starting points instead of a repeat of the project overview. */
function ExploreStart({
  ws,
  snapshotId,
  repositoryId,
  onWalk,
}: {
  ws: WorkspaceState;
  snapshotId: string;
  repositoryId: string;
  onWalk: (flowId: string) => void;
}) {
  const o = ws.overview;
  const starts = o?.startingPoints ?? [];
  const entries = (o?.facts.entryPoints ?? []).filter((p) => !starts.some((s) => s.path === p));
  return (
    <div className="viewer-empty">
      <span className="eyebrow">Explore</span>
      <h2>Start investigating</h2>
      <p className="muted">
        Choose a file on the left (press <kbd>/</kbd> to filter), or begin from one of these. Select any code
        and press <kbd>E</kbd> to see what it does and what it connects to.
      </p>
      {(starts.length > 0 || entries.length > 0) && (
        <section className="section" aria-labelledby="ex-start-h">
          <h3 id="ex-start-h">Starting points</h3>
          <ul className="bare-list stack">
            {starts.map((s, i) => (
              <li key={`s${i}`}>
                <button
                  type="button"
                  className="code-cite"
                  onClick={() => ws.navigate(s.path, s.line, s.label)}
                >
                  <span>{s.label}</span>
                  <span className="path">
                    {s.path}:{s.line}
                  </span>
                </button>
              </li>
            ))}
            {entries.map((p) => (
              <li key={p}>
                <button type="button" className="code-cite" onClick={() => ws.openFile(p)}>
                  <span>Entry point</span>
                  <span className="path">{p}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <FlowList snapshotId={snapshotId} onWalk={onWalk} compact />
      <Bookmarks repositoryId={repositoryId} compact onOpen={(p, l, label) => ws.navigate(p, l, label)} />
      <section className="section" aria-labelledby="ex-keys-h">
        <h3 id="ex-keys-h">Keyboard</h3>
        <ul className="plain-list small muted">
          <li>
            <kbd>/</kbd> filter files · <kbd>T</kbd> show or hide files
          </li>
          <li>
            <kbd>E</kbd> explain the selection or the name under the cursor
          </li>
          <li>
            <kbd>Alt</kbd>+<kbd>←</kbd> / <kbd>→</kbd> back and forward along your trail
          </li>
        </ul>
      </section>
    </div>
  );
}

/**
 * The repository workspace (P2.2): one top bar (project switcher, modes) over shared state. Learn and Explore are
 * separate tracks, each restored from the server, so exploring never moves the learning position and "Return to
 * learning" goes back to the exact stop. Project and Validate read the same state.
 */
function Loaded({
  snap,
  mode,
  depth,
  setDepth,
  health,
  initial,
  onUrl,
  onDeleted,
}: {
  snap: SnapshotView;
  mode: Mode;
  depth: Depth;
  setDepth: (d: Depth) => void;
  health: ReturnType<typeof useHealth>;
  initial: { path: string | null; line: number | null };
  onUrl: (path: string | null, line: number | null) => void;
  onDeleted: () => void;
}) {
  const nav = useNavigate();
  const share = new URLSearchParams(useLocation().search).get('share');
  const go = (m: Mode) => nav(`/r/${snap.id}/${m}${share ? `?share=${encodeURIComponent(share)}` : ''}`);
  const target = { id: snap.id, repositoryId: snap.repositoryId, commitSha: snap.commitSha };
  const learning = useWorkspace(target, 'learning');
  const exploration = useWorkspace(target, 'exploration', initial);
  const [guide, setGuide] = useLearnGuide(snap.repositoryId);
  const [flowId, setFlowIdRaw] = useState<string | null>(null);
  const [graphView, setGraphView] = useState<GraphView>('architecture');
  const [drill, setDrill] = useState<Drill>({ level: 'app' });
  const setFlowId = (id: string | null) => {
    setFlowIdRaw(id);
    if (id) setGraphView('flows');
  };
  const paths = usePaths(snap.id);
  const tour = useTour(snap.id);
  const bookmarkTarget = { repositoryId: snap.repositoryId, commitSha: snap.commitSha };
  const name = repoName(snap.repository);

  useEffect(() => {
    document.title = `${name} · ${mode[0]!.toUpperCase()}${mode.slice(1)} · Know Your Code`;
    return () => {
      document.title = 'Know Your Code';
    };
  }, [name, mode]);

  const startPath = (id: string) => {
    setGuide({ kind: 'path', id });
    go('learn');
  };
  const startTour = () => {
    setGuide({ kind: 'tour' });
    go('learn');
  };
  const exploreAt = (p: string, l: number, label: string) => {
    exploration.navigate(p, l, label);
    go('explore');
  };

  return (
    <div className="page workspace-page">
      <Header>
        <RepoMenu
          repositoryId={snap.repositoryId}
          snapshotId={snap.id}
          name={name}
          partial={snap.status === 'ready_partial'}
          onDeleted={onDeleted}
        />
        <ModeNav snapshotId={snap.id} />
      </Header>
      <AiStatusBanner health={health} />
      {mode === 'project' && (
        <div style={{ overflow: 'auto', flex: 1 }}>
          <ProjectMode
            name={name}
            learning={learning}
            overview={learning.overview}
            paths={paths.view}
            pathsError={paths.error}
            tour={tour}
            onLearnAt={(p, l) => {
              learning.openFile(p, l);
              go('learn');
            }}
            onContinue={() => go('learn')}
            onStartPath={startPath}
            onStartTour={startTour}
            onExplore={() => go('explore')}
            map={
              <ProjectMap
                snapshotId={snap.id}
                onExplore={() => go('explore')}
                onExploreModule={(key) => {
                  setGraphView('architecture');
                  setDrill({ level: 'module', key });
                  go('explore');
                }}
              />
            }
          >
            <ArchitectureMap
              snapshotId={snap.id}
              onOpenFile={(p) => {
                exploration.openFile(p);
                go('explore');
              }}
            />
            <FlowList
              snapshotId={snap.id}
              onWalk={(id) => {
                setFlowId(id);
                go('explore');
              }}
            />
            <Concepts snapshotId={snap.id} onOpen={exploreAt} />
            <Bookmarks repositoryId={snap.repositoryId} onOpen={exploreAt} />
          </ProjectMode>
        </div>
      )}
      {mode === 'learn' && (
        <WorkspaceView
          ws={learning}
          depth={depth}
          setDepth={setDepth}
          bookmarkTarget={bookmarkTarget}
          guide={(place) =>
            guide.kind === 'path' ? (
              <PathPlayer
                key={guide.id}
                snapshotId={snap.id}
                pathId={guide.id}
                place={place}
                onGo={(p, l, label) => learning.navigate(p, l, label)}
                onClose={() => setGuide({ kind: 'home' })}
                onProgress={paths.reload}
              />
            ) : guide.kind === 'tour' ? (
              <TourBar
                snapshotId={snap.id}
                currentPath={learning.entry?.path ?? null}
                currentLine={learning.entry?.line ?? null}
                onGo={(p, l, label) => learning.navigate(p, l, label)}
                onClose={() => setGuide({ kind: 'home' })}
              />
            ) : (
              <LearnHome
                learning={learning}
                paths={paths.view}
                pathsError={paths.error}
                tour={tour}
                onStartPath={(id) => setGuide({ kind: 'path', id })}
                onStartTour={() => setGuide({ kind: 'tour' })}
              />
            )
          }
          empty={({ openFiles }) => (
            <div className="viewer-empty">
              <EmptyState
                title="The code you're learning appears here"
                action={
                  <button type="button" className="btn btn-small" onClick={openFiles}>
                    Browse files
                  </button>
                }
              >
                Choose a path or the guided tour, and each step opens its code here. Or open any file and
                select code to learn it at your own pace.
              </EmptyState>
            </div>
          )}
          actions={
            <>
              <SaveStatus ws={learning} />
              <button type="button" className="btn btn-small" onClick={() => go('explore')}>
                Explore freely
              </button>
            </>
          }
        />
      )}
      {mode === 'explore' && (
        <ExploreBody
          snap={snap}
          ws={exploration}
          depth={depth}
          setDepth={setDepth}
          onUrl={onUrl}
          bookmarkTarget={bookmarkTarget}
          readOnly={!!share}
          view={graphView}
          onView={setGraphView}
          drill={drill}
          onDrill={setDrill}
          flowId={flowId}
          onFlow={setFlowId}
          actions={
            <>
              <SaveStatus ws={exploration} />
              {learning.entry && (
                <button type="button" className="btn btn-small" onClick={() => go('learn')}>
                  Return to learning
                </button>
              )}
            </>
          }
        />
      )}
      {mode === 'validate' && (
        <div style={{ overflow: 'auto', flex: 1 }}>
          <ValidateMode
            repositoryId={snap.repositoryId}
            tracks={[learning, exploration]}
            onOpen={(p, l) => exploreAt(p, l, `${p.split('/').pop()}:${l}`)}
            onLearn={() => go('learn')}
          />
        </div>
      )}
    </div>
  );
}
