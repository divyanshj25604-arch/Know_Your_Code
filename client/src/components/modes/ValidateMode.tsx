import { useEffect, useState } from 'react';
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
}: {
  explanationId: string;
  label: string;
  onOpen: (path: string, line: number) => void;
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
    } catch (e) {
      fail(e);
    }
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
          onStart={() => {
            setCheck({ question: null, result: null, loading: true, error: null });
            void api
              .createCheck(explanationId)
              .then((question) => setCheck({ question, result: null, loading: false, error: null }))
              .catch(fail);
          }}
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

/**
 * Validate mode (P2.2): check understanding of what has been explained so far, in the learning trail first, without
 * moving either the learning or the exploration position.
 */
export function ValidateMode({
  tracks,
  onOpen,
}: {
  tracks: Workspace[];
  onOpen: (path: string, line: number) => void;
}) {
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
      <ul className="plain-list">
        {items.map((x) => (
          <ValidateItem
            key={x.explanationId}
            explanationId={x.explanationId}
            label={x.label}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </main>
  );
}
