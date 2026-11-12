import { useState } from 'react';
import type { ExplState } from '../../lib/expl';
import { CheckCard } from '../CheckCard';

/**
 * An optional understanding check for one explanation: offer, loading, failure, question and result. Presentational
 * (state and actions come from the caller), so it is used in the workspace panel and in Validate mode (P2.2).
 * With `onAnswerText`, the learner can also answer in their own words (graded by the server).
 */
export function CheckSection({
  check,
  onStart,
  onStartOpen,
  onAnswer,
  onAnswerText,
  onClose,
  onOpen,
}: {
  check: ExplState['check'];
  onStart: () => void;
  /** Offer a question answered in the learner's own words (graded against a rubric). */
  onStartOpen?: () => void;
  onAnswer: (i: number) => void;
  onAnswerText?: (text: string) => void;
  onClose: () => void;
  onOpen: (path: string, line: number) => void;
}) {
  const [text, setText] = useState('');
  return (
    <>
      {!check && (
        <p className="row">
          <button type="button" className="btn btn-quiet" onClick={onStart}>
            Check yourself <span className="muted">(optional, 30 s)</span>
          </button>
          {onStartOpen && (
            <button type="button" className="btn btn-quiet" onClick={onStartOpen}>
              Explain it in your own words
            </button>
          )}
        </p>
      )}
      {check?.loading && (
        <p className="muted" role="status">
          Writing a question…
        </p>
      )}
      {check?.error && !check.question && (
        <p className="muted" role="status">
          Couldn't make a good question for this code.{' '}
          <button type="button" className="link" onClick={onClose}>
            Dismiss
          </button>
        </p>
      )}
      {check?.question && (
        <CheckCard
          question={check.question}
          result={check.result}
          onAnswer={onAnswer}
          onSkip={onClose}
          onOpen={onOpen}
        />
      )}
      {check?.question && !check.result && onAnswerText && (
        <form
          className="ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onAnswerText(text.trim());
          }}
        >
          <label className="muted small" htmlFor={`check-text-${check.question.checkId}`}>
            Or answer in your own words
          </label>
          <textarea
            id={`check-text-${check.question.checkId}`}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn btn-small" disabled={!text.trim()}>
            Check my answer
          </button>
        </form>
      )}
      {check?.result?.points && check.result.points.length > 0 && (
        <ul className="rubric" aria-label="Rubric">
          {check.result.points.map((p) => (
            <li key={p.point}>
              {p.met ? '✓' : '○'} {p.point}
              <span className="sr-only">{p.met ? ' (covered)' : ' (missing)'}</span>
            </li>
          ))}
        </ul>
      )}
      {check?.result?.verdict && (
        <p
          className={`result ${check.result.verdict === 'correct' ? 'result-ok' : 'result-no'}`}
          role="status"
        >
          {check.result.verdict === 'correct'
            ? 'Correct.'
            : check.result.verdict === 'partly'
              ? 'Partly right.'
              : 'Not quite.'}{' '}
          {check.result.feedback}
        </p>
      )}
    </>
  );
}
