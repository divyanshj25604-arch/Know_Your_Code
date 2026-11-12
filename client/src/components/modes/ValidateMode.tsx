import { useEffect, useState } from 'react';
import type { AssessmentResults } from '@kyc/contracts';
import { api, ApiError, type StoredExplanation } from '../../api/client';
import type { ExplState } from '../../lib/expl';
import { explStateOf, loadExplanation } from '../../state/explanations';
import type { Workspace } from '../../hooks/useWorkspace';
import { CheckSection } from '../explanation/CheckSection';
import { ExplanationSections } from '../explanation/ExplanationSections';
import { EmptyState, ErrorState, PageHeader, ProgressMeter, Skeleton } from '../ui';

type Check = ExplState['check'];

/** One explanation to validate: its content (reused panel part) and an understanding check (reused panel part). */
function ValidateItem({
  explanationId,
  label,
  where,
  onOpen,
  onAnswered,
}: {
  explanationId: string;
  label: string;
  where: string;
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
        <summary>
          <span>{label}</span>
          <span className="path small">{where}</span>
          <span className="sr-only">(show the explanation)</span>
        </summary>
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
          This code has been deleted (imported code is kept for a limited time). Import the repository again
          to practise.
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
  const s = r?.summary;
  return (
    <section className="card" aria-labelledby="results-h">
      <h2 id="results-h" className="card-h">
        Your results
      </h2>
      {!r || r.checks.length === 0 || !s ? (
        <p className="muted small">
          No answers yet. Each question you answer is recorded here with every attempt.
        </p>
      ) : (
        <>
          <ProgressMeter label="Checks answered" value={s.attempted} total={s.checks} />
          <p className="small">
            {s.attempted} of {s.checks} checks answered · {s.correct} correct
            {s.averageScore !== null ? ` · average score ${Math.round(s.averageScore * 100)}%` : ''}
          </p>
          <ul className="bare-list">
            {r.checks.map((c) => (
              <li key={c.checkId} className="results-q">
                <p>
                  <strong>{c.question}</strong>{' '}
                  <span className="tag">{c.format === 'open' ? 'own words' : 'choice'}</span>
                </p>
                {c.attempts.length === 0 ? (
                  <p className="muted small">Not answered yet.</p>
                ) : (
                  <ol className="attempts small" aria-label="Attempts, newest first">
                    {c.attempts.map((a) => (
                      <li key={a.id}>
                        <span aria-hidden="true">
                          {a.verdict === 'correct' ? '✓ ' : a.verdict === 'partly' ? '◐ ' : '○ '}
                        </span>
                        {a.verdict === 'correct' ? 'Correct' : a.verdict === 'partly' ? 'Partly' : 'Not yet'}{' '}
                        ({Math.round(a.score * 100)}%) ·{' '}
                        <span className="muted">{new Date(a.createdAt).toLocaleString()}</span>
                        {a.answer.text ? <span className="muted"> · “{a.answer.text}”</span> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Validate mode (P2.2, P3.5): a learning checkpoint. Every stop you explained (learning trail first) becomes a
 * checkpoint with a quick question or an answer in your own words, graded with evidence. Your results and every
 * attempt sit alongside. Neither the learning nor the exploration position moves.
 */
export function ValidateMode({
  repositoryId,
  tracks,
  onOpen,
  onLearn,
}: {
  repositoryId: string;
  tracks: Workspace[];
  onOpen: (path: string, line: number) => void;
  onLearn: () => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const seen = new Set<string>();
  const items = tracks
    .flatMap((t) => t.explanations)
    .filter((x) => !seen.has(x.explanationId) && seen.add(x.explanationId));
  const ready = tracks.every((t) => t.restored);
  return (
    <main className="page-main" id="main">
      <PageHeader
        eyebrow="Validate"
        title="Check your understanding"
        lede="Each checkpoint is code you had explained. Answer a quick question, or explain it in your own words, and see which lines prove the answer."
      />
      <div className="validate-layout">
        <section aria-labelledby="checkpoints-h">
          <h2 id="checkpoints-h" className="section-h">
            Checkpoints {ready && items.length > 0 && <span className="tag">{items.length}</span>}
          </h2>
          {!ready && <Skeleton lines={4} />}
          {ready && items.length === 0 && (
            <EmptyState
              title="Nothing to check yet"
              action={
                <button type="button" className="btn btn-primary" onClick={onLearn}>
                  Go to Learn
                </button>
              }
            >
              Explain some code in Learn or Explore, then come back to test yourself on it.
            </EmptyState>
          )}
          <ul className="validate-list">
            {items.map((x) => (
              <ValidateItem
                key={x.explanationId}
                explanationId={x.explanationId}
                label={x.label}
                where={`${x.path}:${x.line}`}
                onOpen={onOpen}
                onAnswered={() => setRefreshKey((k) => k + 1)}
              />
            ))}
          </ul>
        </section>
        <aside aria-label="Progress">
          <Results repositoryId={repositoryId} refreshKey={refreshKey} />
        </aside>
      </div>
    </main>
  );
}
