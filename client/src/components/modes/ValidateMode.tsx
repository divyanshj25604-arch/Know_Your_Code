import { useEffect, useState } from 'react';
import type { AssessmentResults } from '@kyc/contracts';
import { api, ApiError, type StoredExplanation } from '../../api/client';
import type { ExplState } from '../../lib/expl';
import { explStateOf, loadExplanation } from '../../state/explanations';
import type { Workspace } from '../../hooks/useWorkspace';
import { CheckSection } from '../explanation/CheckSection';
import { ExplanationSections } from '../explanation/ExplanationSections';
import { ErrorState, Skeleton } from '../ui';

type Check = ExplState['check'];

/** One explanation to validate: its content (reused panel part) and an understanding check (reused panel part). */
function ValidateItem({
  explanationId,
  label,
  onOpen,
  onAnswered,
}: {
  explanationId: string;
  label: string;
  onOpen: (path: string, line: number) => void;
  onAnswered: () => void;
}) {
  const [stored, setStored] = useState<StoredExplanation | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [check, setCheck] = useState<Check>(null);
  useEffect(() => {
    loadExplanation(explanationId)
      .then(setStored)
      .catch((e: unknown) =>
        setError(
          e instanceof ApiError ? e : new ApiError('SERVICE_UNAVAILABLE', 'Something went wrong.', true, 0),
        ),
      );
  }, [explanationId]);

  const fail = (e: unknown) =>
    setCheck((c) => ({
      question: c?.question ?? null,
      result: c?.result ?? null,
      loading: false,
      error: e instanceof ApiError ? e.message : 'Something went wrong.',
    }));
  const grade = async (answer: Promise<NonNullable<Check>['result']>) => {
    try {
      const result = await answer;
      setCheck((c) => (c ? { ...c, result } : c));
      onAnswered();
    } catch (e) {
      fail(e);
    }
  };

  const start = (format: 'choice' | 'open') => {
    setCheck({ question: null, result: null, loading: true, error: null });
    void api
      .createCheck(explanationId, format)
      .then((question) => setCheck({ question, result: null, loading: false, error: null }))
      .catch(fail);
  };

  return (
    <li className="validate-item">
      <details>
        <summary className="panel-h">{label}</summary>
        {error && <ErrorState code={error.code} message={error.message} />}
        {!stored && !error && <Skeleton lines={3} />}
        {stored && <ExplanationSections ex={explStateOf(stored, label)} onOpenRef={onOpen} />}
      </details>
      {stored && stored.snapshotId && (
        <CheckSection
          check={check}
          onStart={() => start('choice')}
          onStartOpen={() => start('open')}
          onAnswer={(i) => void grade(api.answerCheck(check!.question!.checkId, i))}
          onAnswerText={(t) => void grade(api.answerCheckText(check!.question!.checkId, t))}
          onClose={() => setCheck(null)}
          onOpen={onOpen}
        />
      )}
      {stored && !stored.snapshotId && (
        <p className="muted small">
          This code was deleted after 7 days. Import the repository again to practise.
        </p>
      )}
    </li>
  );
}

/** Results (P3.5): every check and every attempt in this repository, newest first. */
function Results({ repositoryId, refreshKey }: { repositoryId: string; refreshKey: number }) {
  const [r, setR] = useState<AssessmentResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .assessment(repositoryId)
      .then(setR)
      .catch((e: unknown) =>
        e instanceof ApiError && e.status === 404
          ? setR(null)
          : setError('Your results could not be loaded.'),
      );
  }, [repositoryId, refreshKey]);
  if (error) return <p className="muted">{error}</p>;
  if (!r || r.checks.length === 0) return null;
  const s = r.summary;
  return (
    <section className="sec" aria-labelledby="results-h">
      <h2 id="results-h" className="panel-h">
        Your results
      </h2>
      <p>
        {s.attempted} of {s.checks} checks answered · {s.correct} correct
        {s.averageScore !== null ? ` · average score ${Math.round(s.averageScore * 100)}%` : ''}
      </p>
      <ul className="plain-list">
        {r.checks.map((c) => (
          <li key={c.checkId} className="validate-item">
            <p>
              <strong>{c.question}</strong>{' '}
              <span className="tag">{c.format === 'open' ? 'own words' : 'choice'}</span>
            </p>
            {c.attempts.length === 0 ? (
              <p className="muted small">Not answered yet.</p>
            ) : (
              <ol className="small" aria-label="Attempts, newest first">
                {c.attempts.map((a) => (
                  <li key={a.id}>
                    {a.verdict === 'correct' ? 'Correct' : a.verdict === 'partly' ? 'Partly' : 'Not yet'} (
                    {Math.round(a.score * 100)}%) · {new Date(a.createdAt).toLocaleString()}
                    {a.answer.text ? <span className="muted"> · “{a.answer.text}”</span> : null}
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Validate mode (P2.2): check understanding of what has been explained so far, in the learning trail first, without
 * moving either the learning or the exploration position.
 */
export function ValidateMode({
  repositoryId,
  tracks,
  onOpen,
}: {
  repositoryId: string;
  tracks: Workspace[];
  onOpen: (path: string, line: number) => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const seen = new Set<string>();
  const items = tracks
    .flatMap((t) => t.explanations)
    .filter((x) => !seen.has(x.explanationId) && seen.add(x.explanationId));
  return (
    <main className="mode-page" id="main">
      <h1 className="page-title">Check your understanding</h1>
      {!tracks.every((t) => t.restored) && <Skeleton lines={4} />}
      {tracks.every((t) => t.restored) && items.length === 0 && (
        <p className="muted">
          Nothing to check yet. Explain some code in Learn or Explore, then come back to test yourself.
        </p>
      )}
      <Results repositoryId={repositoryId} refreshKey={refreshKey} />
      <ul className="plain-list">
        {items.map((x) => (
          <ValidateItem
            key={x.explanationId}
            explanationId={x.explanationId}
            label={x.label}
            onOpen={onOpen}
            onAnswered={() => setRefreshKey((k) => k + 1)}
          />
        ))}
      </ul>
    </main>
  );
}
