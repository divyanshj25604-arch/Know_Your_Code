import { useEffect, useState } from 'react';
import type {
  LearningPathView,
  PathItemResult,
  PathItemView,
  PathsView,
  ProgressStatus,
} from '@kyc/contracts';
import { api, ApiError } from '../../api/client';

const STATUS: Record<ProgressStatus, string> = {
  not_started: 'Not started',
  started: 'In progress',
  completed: 'Completed',
};
const KIND: Record<PathItemView['kind'], string> = {
  lesson: 'Lesson',
  mission: 'Mission',
  check: 'Knowledge check',
};
const mark = (s: ProgressStatus) => (s === 'completed' ? '✓' : s === 'started' ? '◐' : '○');

/** Learning paths on the project page (P3.7): what exists and how far the learner is. */
export function PathList({ snapshotId, onOpen }: { snapshotId: string; onOpen: (pathId: string) => void }) {
  const [view, setView] = useState<PathsView | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api
      .paths(snapshotId)
      .then(setView)
      .catch(() => setError(true));
  }, [snapshotId]);
  if (error || !view || view.paths.length === 0) return null;
  return (
    <section className="sec" aria-labelledby="paths-h">
      <h2 id="paths-h" className="panel-h">
        Learning paths
      </h2>
      <ul className="arch-map">
        {view.paths.map((p) => (
          <li key={p.id} className="arch-node" aria-label={`Path ${p.title}`}>
            <strong>{p.title}</strong> <span className="tag">{STATUS[p.status]}</span>
            <p className="small muted">{p.summary}</p>
            <p className="small">{p.items.map((i) => `${mark(i.status)} ${KIND[i.kind]}`).join(' · ')}</p>
            <button type="button" className="btn btn-small" onClick={() => onOpen(p.id)}>
              {p.status === 'not_started' ? 'Start' : p.status === 'completed' ? 'Review' : 'Continue'}{' '}
              {p.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A learning path in Learn mode (P3.7): lessons (text and real code that opens in the viewer), missions (find a
 * place in the code, then mark it; checked on the server against the code graph) and knowledge checks (graded on the
 * server). Progress is saved per repository, so it survives new snapshots of the same code.
 */
export function PathPlayer({
  snapshotId,
  pathId,
  place,
  onGo,
  onClose,
}: {
  snapshotId: string;
  pathId: string;
  /** The place in the code the learner is at (viewer cursor, or the current stop). */
  place: () => { path: string; line: number } | null;
  onGo: (path: string, line: number, label: string) => void;
  onClose: () => void;
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
    void load(false);
  }, [snapshotId, pathId]);

  if (error) return <p className="note">{error}</p>;
  if (!path) return null;
  const item = path.items[at]!;

  const submit = async (body: Parameters<typeof api.submitPathItem>[3]) => {
    setBusy(true);
    try {
      const r = await api.submitPathItem(snapshotId, path.id, item.id, body);
      setResult(r);
      await load(true);
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

  return (
    <section className="note tour-bar path-player" aria-label="Learning path">
      <p>
        <strong>{path.title}</strong> <span className="tag">{STATUS[path.status]}</span>{' '}
        <button type="button" className="link" onClick={onClose}>
          Close path
        </button>
      </p>
      <ol className="path-items" aria-label="Path items">
        {path.items.map((i, n) => (
          <li key={i.id} aria-current={n === at ? 'step' : undefined}>
            <button type="button" className="link small" onClick={() => goItem(n)}>
              {mark(i.status)} {KIND[i.kind]}: {i.title}
            </button>
          </li>
        ))}
      </ol>
      <div className="path-item" aria-label={`${KIND[item.kind]}: ${item.title}`} role="group">
        <h3 className="panel-h">
          {KIND[item.kind]}: {item.title}
        </h3>
        {item.kind === 'lesson' && (
          <>
            {item.blocks?.map((b, n) =>
              b.type === 'text' ? (
                <p key={n}>{b.text}</p>
              ) : (
                <p key={n}>
                  <button
                    type="button"
                    className="link mono small"
                    onClick={() => onGo(b.path, b.line, b.label)}
                  >
                    {b.label} ({b.path}:{b.line})
                  </button>
                </p>
              ),
            )}
            {item.status !== 'completed' && (
              <button
                type="button"
                className="btn btn-small btn-primary"
                disabled={busy}
                onClick={() => submit({ kind: 'lesson' })}
              >
                Mark lesson complete
              </button>
            )}
          </>
        )}
        {item.kind === 'mission' && (
          <>
            <p>{item.goal}</p>
            <p className="small muted">Hint: {item.hint}</p>
            <p className="small">
              Open the code, click a line you think is right, then{' '}
              <button
                type="button"
                className="btn btn-small btn-primary"
                disabled={busy}
                onClick={() => {
                  const at = place();
                  if (at) void submit({ kind: 'mission', ...at });
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
            </p>
          </>
        )}
        {item.kind === 'check' && (
          <>
            <p>{item.question}</p>
            <div className="row" role="group" aria-label="Options">
              {item.options?.map((o, n) => (
                <button
                  key={o}
                  type="button"
                  className="btn btn-small"
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
          <p role="status">
            <strong>{result.correct ? '✓' : '✗'}</strong> {result.feedback}{' '}
            {result.refs.map((r) => (
              <button
                key={`${r.path}:${r.line}`}
                type="button"
                className="link mono small"
                onClick={() => onGo(r.path, r.line, `${r.path.split('/').pop()}:${r.line}`)}
              >
                {r.path}:{r.line}
              </button>
            ))}
          </p>
        )}
        {result?.pathStatus === 'completed' && <p role="status">Path complete. Your progress is saved.</p>}
        <p className="row">
          <button type="button" className="btn btn-small" disabled={at <= 0} onClick={() => goItem(at - 1)}>
            Previous item
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={at >= path.items.length - 1}
            onClick={() => goItem(at + 1)}
          >
            Next item
          </button>
        </p>
      </div>
    </section>
  );
}
