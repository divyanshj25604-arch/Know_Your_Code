import { useEffect, useRef, useState } from 'react';
import { repoName } from '../lib/repoName';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { SnapshotView } from '@kyc/contracts';
import { api, ApiError } from '../api/client';
import { ErrorState, OnboardSteps, PageHeader } from '../components/ui';
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
      <main className="narrow" id="main">
        <OnboardSteps current={2} />
        <PageHeader
          eyebrow="Analysing"
          title={snap ? repoName(snap.repository) : 'Opening repository…'}
          lede="We read the code without running it. The project opens on its own when analysis finishes."
        />
        {error && !snap && <ErrorState code={error.code} message={error.message} />}
        {snap && (
          <div role="status" aria-live="polite">
            <StageProgress stages={snap.stages} source={snap.repository.source} />
            {snap.stages.find((x) => x.name === 'filtering')?.state === 'done' && snap.skippedCount > 0 && (
              <p className="small muted">
                {snap.skippedCount.toLocaleString()} file{snap.skippedCount === 1 ? ' was' : 's were'} set
                aside (binaries, dependencies, generated code or possible secrets). The project lists them
                once it opens.
              </p>
            )}
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
        {!failed && snap?.status !== 'expired' && (
          <section className="card" aria-labelledby="next-h">
            <h2 id="next-h" className="card-h">
              What you'll see next
            </h2>
            <ul className="plain-list">
              <li>
                <strong>Project</strong>: what the code is made of, an interactive architecture map, and where
                to start.
              </li>
              <li>
                <strong>Learn</strong>: learning paths and a guided tour through the real code.
              </li>
              <li>
                <strong>Explore</strong>: code, graph and explanation side by side. Select a node or a line to
                see how it connects.
              </li>
            </ul>
          </section>
        )}
        <p>
          <Link to="/">← Home</Link>
        </p>
      </main>
    </div>
  );
}
