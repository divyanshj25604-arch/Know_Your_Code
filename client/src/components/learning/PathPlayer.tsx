import { useEffect, useState } from 'react';
import type {
  LearningPathView,
  PathItemResult,
  PathItemView,
  PathsView,
  ProgressStatus,
} from '@kyc/contracts';
import { api, ApiError } from '../../api/client';
import { EmptyState, ProgressMeter, Skeleton } from '../ui';

export const STATUS: Record<ProgressStatus, string> = {
  not_started: 'Not started',
  started: 'In progress',
  completed: 'Completed',
};
const KIND: Record<PathItemView['kind'], string> = {
  lesson: 'Lesson',
  mission: 'Mission',
  check: 'Knowledge check',
};
export const mark = (s: ProgressStatus) => (s === 'completed' ? '✓' : s === 'started' ? '◐' : '○');
export const doneCount = (p: LearningPathView) => p.items.filter((i) => i.status === 'completed').length;
export const pathAction = (p: LearningPathView) =>
  p.status === 'not_started' ? 'Start' : p.status === 'completed' ? 'Review' : 'Continue';

/** Learning paths with progress (P3.7), as cards. Used on the project page and in the Learn home. */
export function PathList({
  view,
  error,
  onOpen,
  headingLevel = 2,
}: {
  view: PathsView | null;
  error: boolean;
  onOpen: (pathId: string) => void;
  headingLevel?: 2 | 3;
}) {
  if (error) return <p className="muted">Learning paths couldn't be loaded.</p>;
  if (!view) return <Skeleton lines={3} />;
  if (view.paths.length === 0)
    return (
      <EmptyState title="No learning paths for this code yet">
        Paths are built from request flows and concepts the analysis finds. Try the guided tour, or explore
        the code freely.
      </EmptyState>
    );
  const H = headingLevel === 2 ? 'h3' : 'h4';
  return (
    <ul className="arch-map">
      {view.paths.map((p) => (
        <li key={p.id} className="arch-node" aria-label={`Path ${p.title}`}>
          <H className="node-title">{p.title}</H>
          <p>
            <span className="tag">
              {mark(p.status)} {STATUS[p.status]}
            </span>
          </p>
          <p className="small muted">{p.summary}</p>
          <ProgressMeter label={`${p.items.length} steps`} value={doneCount(p)} total={p.items.length} />
          <div className="node-actions">
            <button type="button" className="btn btn-small" onClick={() => onOpen(p.id)}>
              {pathAction(p)} {p.title}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A learning path in the Learn guide column (P3.7): the item list with progress, then the current item. Lessons cite
 * real code that opens in the viewer beside it; missions ask the learner to find a place in the code and mark it
 * (checked on the server against the code graph); knowledge checks are graded on the server. Progress is saved per
 * repository, so it survives new snapshots of the same code.
 */
export function PathPlayer({
  snapshotId,
  pathId,
  place,
  onGo,
  onClose,
  onProgress,
}: {
  snapshotId: string;
  pathId: string;
  /** The place in the code the learner is at (viewer cursor, or the current stop). */
  place: () => { path: string; line: number } | null;
  onGo: (path: string, line: number, label: string) => void;
  onClose: () => void;
  /** Progress changed (so other views can refresh). */
  onProgress?: () => void;
}) {
  const [path, setPath] = useState<LearningPathView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [result, setResult] = useState<PathItemResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = (keepPosition: boolean) =>
    api
      .paths(snapshotId)
      .then((v) => {
        const p = v.paths.find((x) => x.id === pathId) ?? null;
        setPath(p);
        if (p && !keepPosition) {
          const next = p.items.findIndex((i) => i.status !== 'completed');
          setAt(next < 0 ? 0 : next);
        }
        if (!p) setError('This learning path is not available for this snapshot.');
      })
      .catch(() => setError("The learning path couldn't be loaded."));

  useEffect(() => {
    setResult(null);
    setError(null);
    void load(false);
  }, [snapshotId, pathId]);

  if (error)
    return (
      <section className="guide" aria-label="Learning path">
        <p className="note">{error}</p>
        <button type="button" className="btn btn-small" onClick={onClose}>
          Back to Learn
        </button>
      </section>
    );
  if (!path)
    return (
      <div className="guide">
        <Skeleton lines={6} />
      </div>
    );
  const item = path.items[at]!;

  const submit = async (body: Parameters<typeof api.submitPathItem>[3]) => {
    setBusy(true);
    try {
      const r = await api.submitPathItem(snapshotId, path.id, item.id, body);
      setResult(r);
      await load(true);
      onProgress?.();
    } catch (e) {
      setResult({
        correct: false,
        feedback: e instanceof ApiError ? e.message : 'That could not be checked. Try again.',
        itemStatus: item.status,
        pathStatus: path.status,
        refs: [],
      });
    } finally {
      setBusy(false);
    }
  };
  const goItem = (i: number) => {
    setAt(i);
    setResult(null);
  };
  const isLast = at >= path.items.length - 1;

  return (
    <section className="guide" aria-label="Learning path">
      <div className="guide-head">
        <div>
          <span className="eyebrow">Learning path</span>
          <h2>{path.title}</h2>
        </div>
        <button type="button" className="btn btn-small btn-quiet" onClick={onClose}>
          Close path
        </button>
      </div>
      <ProgressMeter label={STATUS[path.status]} value={doneCount(path)} total={path.items.length} />
      <ol className="path-items" aria-label="Path items">
        {path.items.map((i, n) => (
          <li key={i.id} aria-current={n === at ? 'step' : undefined}>
            <button type="button" onClick={() => goItem(n)}>
              <span className="glyph" aria-hidden="true">
                {mark(i.status)}
              </span>
              <span>
                {KIND[i.kind]}: {i.title}
                <span className="sr-only"> ({STATUS[i.status]})</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="path-item guide-block" aria-label={`${KIND[item.kind]}: ${item.title}`} role="group">
        <span className="eyebrow">
          {KIND[item.kind]} {at + 1} of {path.items.length}
        </span>
        <h3>{item.title}</h3>
        {item.kind === 'lesson' && (
          <>
            {item.blocks?.map((b, n) =>
              b.type === 'text' ? (
                <p key={n}>{b.text}</p>
              ) : (
                <button
                  key={n}
                  type="button"
                  className="code-cite"
                  onClick={() => onGo(b.path, b.line, b.label)}
                >
                  <span>{b.label}</span>
                  <span className="path">
                    {b.path}:{b.line}
                  </span>
                </button>
              ),
            )}
            {item.status !== 'completed' && (
              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => submit({ kind: 'lesson' })}
                >
                  Mark lesson complete
                </button>
              </div>
            )}
          </>
        )}
        {item.kind === 'mission' && (
          <>
            <p>{item.goal}</p>
            <details>
              <summary className="small">Need a hint?</summary>
              <p className="small muted">{item.hint}</p>
            </details>
            <ol className="plain-list small">
              <li>Open the file you think is right (Files, or press T).</li>
              <li>Click the line in the code.</li>
              <li>Mark the place.</li>
            </ol>
            <div className="row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => {
                  const here = place();
                  if (here) void submit({ kind: 'mission', ...here });
                  else
                    setResult({
                      correct: false,
                      feedback: 'Open a file first, then click the line you mean.',
                      itemStatus: item.status,
                      pathStatus: path.status,
                      refs: [],
                    });
                }}
              >
                Mark this place
              </button>
            </div>
          </>
        )}
        {item.kind === 'check' && (
          <>
            <p>{item.question}</p>
            <div className="option-list" role="group" aria-label="Options">
              {item.options?.map((o, n) => (
                <button
                  key={o}
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => submit({ kind: 'check', answerIndex: n })}
                >
                  {o}
                </button>
              ))}
            </div>
          </>
        )}
        {result && (
          <div className={`result ${result.correct ? 'result-ok' : 'result-no'}`}>
            <p role="status">
              <strong aria-hidden="true">{result.correct ? '✓' : '✗'}</strong> {result.feedback}
            </p>
            {result.refs.length > 0 && (
              <p>
                {result.refs.map((r) => (
                  <button
                    key={`${r.path}:${r.line}`}
                    type="button"
                    className="chip chip-ref"
                    onClick={() => onGo(r.path, r.line, `${r.path.split('/').pop()}:${r.line}`)}
                  >
                    {r.path}:{r.line}
                  </button>
                ))}
              </p>
            )}
          </div>
        )}
        {result?.pathStatus === 'completed' && (
          <div className="result result-ok">
            <p role="status">Path complete. Your progress is saved.</p>
            <button type="button" className="btn btn-small" onClick={onClose}>
              Choose what to learn next
            </button>
          </div>
        )}
      </div>
      <div className="guide-nav">
        <button type="button" className="btn btn-small" disabled={at <= 0} onClick={() => goItem(at - 1)}>
          ← Previous item
        </button>
        <button type="button" className="btn btn-small" disabled={isLast} onClick={() => goItem(at + 1)}>
          Next item →
        </button>
      </div>
    </section>
  );
}
