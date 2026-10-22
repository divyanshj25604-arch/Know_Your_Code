import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { SnapshotView } from '@kyc/contracts';
import { api, ApiError } from '../api/client';
import { ErrorState } from '../components/ui';
import { StageProgress } from '../components/StageProgress';
import { Header } from '../components/Shell';

const POLL_MS = 1500;

export function Processing() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [snap, setSnap] = useState<SnapshotView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [slow, setSlow] = useState(false);
  const started = useRef(Date.now());

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await api.snapshot(id);
        if (stop) return;
        setSnap(s);
        setError(null);
        if (s.status === 'ready' || s.status === 'ready_partial') {
          nav(`/r/${id}`, { replace: true });
          return;
        }
        if (s.status === 'failed' || s.status === 'expired') return;
        if (Date.now() - started.current > 120_000) setSlow(true);
      } catch (e) {
        if (stop) return;
        const err =
          e instanceof ApiError ? e : new ApiError('SERVICE_UNAVAILABLE', 'Something went wrong.', true, 0);
        setError(err);
        if (!err.retryable) return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id, nav]);

  const cancel = async () => {
    if (snap) await api.deleteRepo(snap.repositoryId).catch(() => undefined);
    nav('/start');
  };

  const failed = snap?.status === 'failed' ? snap : null;
  const failedStage = failed?.stages.find((s) => s.state === 'failed')?.name;
  return (
    <div className="page">
      <Header />
      <main className="narrow">
        <h1 className="page-title">
          {snap ? `${snap.repository.owner}/${snap.repository.name}` : 'Opening repository…'}
        </h1>
        {error && !snap && <ErrorState code={error.code} message={error.message} />}
        {snap && (
          <div role="status" aria-live="polite">
            <StageProgress stages={snap.stages} />
          </div>
        )}
        {slow && !failed && (
          <p className="muted">
            This is taking longer than expected. It keeps running; this page updates when it's done.
          </p>
        )}
        {failed && (
          <ErrorState
            code={(failed.error?.code as never) ?? 'INDEX_FAILED'}
            message={`${failed.error?.message ?? 'Analysis failed.'}${failedStage ? ` (stage: ${failedStage})` : ''}`}
            onAction={() => nav('/start')}
            actionLabel="Try another repository"
          />
        )}
        {snap?.status === 'expired' && (
          <ErrorState code="SNAPSHOT_EXPIRED" onAction={() => nav('/start')} actionLabel="Import again" />
        )}
        {!failed && snap?.status !== 'expired' && (
          <div className="row">
            <button type="button" className="btn" onClick={() => void cancel()}>
              Cancel
            </button>
          </div>
        )}
        <p className="muted small">
          Tip: once it opens, drag over any code (or double-click a name) and press <kbd>E</kbd> to explain
          it.
        </p>
        <p>
          <Link to="/">← Home</Link>
        </p>
      </main>
    </div>
  );
}
