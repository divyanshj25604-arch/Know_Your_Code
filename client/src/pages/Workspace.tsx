import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SnapshotView } from '@kyc/contracts';
import { api, ApiError } from '../api/client';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { CodeViewer, type Anchor, type ViewerHandle } from '../components/CodeViewer';
import { ExplanationPanel } from '../components/ExplanationPanel';
import { FileTree } from '../components/FileTree';
import { Overview } from '../components/Overview';
import { RepoMenu } from '../components/RepoMenu';
import { AiStatusBanner, Header, useHealth } from '../components/Shell';
import { ErrorState, Skeleton } from '../components/ui';
import { useDepth } from '../hooks/usePrefs';
import { useWorkspace } from '../hooks/useWorkspace';
import type { Selection } from '@kyc/contracts';

export function Workspace() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const health = useHealth();
  const [depth, setDepth] = useDepth();
  const [snap, setSnap] = useState<SnapshotView | null>(null);
  const [snapError, setSnapError] = useState<ApiError | null>(null);
  const initial = useRef({
    path: params.get('path'),
    line: params.get('line') ? Number(params.get('line')) : null,
  });

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

  if (snapError)
    return (
      <Shell>
        <ErrorState
          code={snapError.code}
          message={snapError.message}
          onAction={() => nav('/start')}
          actionLabel="Open another repository"
        />
      </Shell>
    );
  if (snap && (snap.status === 'failed' || snap.status === 'expired')) {
    return (
      <Shell>
        <ErrorState
          code={
            snap.status === 'expired' ? 'SNAPSHOT_EXPIRED' : ((snap.error?.code as never) ?? 'INDEX_FAILED')
          }
          message={snap.error?.message}
          onAction={() => nav('/start')}
          actionLabel="Import again"
        />
      </Shell>
    );
  }
  if (snap && snap.status !== 'ready' && snap.status !== 'ready_partial') {
    nav(`/r/${id}/processing`, { replace: true });
    return null;
  }
  if (!snap)
    return (
      <Shell>
        <Skeleton lines={5} />
      </Shell>
    );

  return (
    <Loaded
      key={id}
      snap={snap}
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <Header />
      <main className="narrow">
        {children}
        <p>
          <Link to="/">← Home</Link>
        </p>
      </main>
    </div>
  );
}

function Loaded({
  snap,
  depth,
  setDepth,
  health,
  initial,
  onUrl,
  onDeleted,
}: {
  snap: SnapshotView;
  depth: import('@kyc/contracts').Depth;
  setDepth: (d: import('@kyc/contracts').Depth) => void;
  health: ReturnType<typeof useHealth>;
  initial: { path: string | null; line: number | null };
  onUrl: (path: string | null, line: number | null) => void;
  onDeleted: () => void;
}) {
  const ws = useWorkspace(snap.id, initial);
  const viewer = useRef<ViewerHandle>(null);
  const [anchor, setAnchor] = useState<{ sel: Selection & { text?: string }; at: Anchor } | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const entry = ws.entry;

  // Keep the URL shareable (FR-NAV-03).
  useEffect(() => {
    onUrl(entry?.path ?? null, entry?.line ?? null);
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

  const showOverview = !entry;
  const markRange = entry?.expl?.selection ?? null;
  const fileData = ws.file.data;

  return (
    <div className="page workspace-page">
      <Header>
        <span className="repo-name" title={`${snap.repository.owner}/${snap.repository.name}`}>
          {snap.repository.owner}/{snap.repository.name}
        </span>
        {snap.status === 'ready_partial' && (
          <span className="tag tag-warn" title="Some files couldn't be analysed. See the overview.">
            partial
          </span>
        )}
        <RepoMenu repositoryId={snap.repositoryId} onDeleted={onDeleted} />
      </Header>
      <AiStatusBanner health={health} />
      <div className="subbar">
        <button
          type="button"
          className="btn btn-small tree-toggle"
          aria-expanded={treeOpen}
          onClick={() => setTreeOpen(!treeOpen)}
        >
          Files
        </button>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => ws.goTo(-1)}
          disabled={!entry}
          aria-label="Project overview"
        >
          Overview
        </button>
        <Breadcrumbs
          entries={ws.entries}
          index={ws.index}
          onJump={ws.goTo}
          onBack={ws.back}
          onForward={ws.forward}
        />
        <button
          type="button"
          className="btn btn-small sheet-toggle"
          aria-expanded={sheet}
          onClick={() => setSheet(!sheet)}
        >
          Explanation
        </button>
      </div>

      <div className={`workspace${treeOpen ? ' tree-open' : ''}${sheet ? ' sheet-open' : ''}`}>
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
          {showOverview && ws.overview && (
            <Overview data={ws.overview} onOpen={(p, l) => ws.openFile(p, l)} />
          )}
          {showOverview && ws.loading && <Skeleton lines={6} />}
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
                <span className="mono">{fileData.path}</span>
                {!fileData.analysable && (
                  <span className="tag tag-warn" title="Shown for reading; no verified relations.">
                    not analysed
                  </span>
                )}
                {fileData.generated && <span className="tag tag-warn">generated</span>}
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => viewer.current?.focus()}
                  aria-label="Focus the code"
                >
                  Focus code
                </button>
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

        <div className="ws-panel">
          <button type="button" className="sheet-close btn btn-small" onClick={() => setSheet(false)}>
            Close
          </button>
          <ExplanationPanel ws={ws} depth={depth} onDepth={setDepth} onOpenRef={openRef} />
        </div>
      </div>
    </div>
  );
}
