import { useId, useState } from 'react';
import type { CheckQuestion, CheckResult } from '../api/client';
import { Inline } from '../lib/inline';
import { LineRefChip } from './ui';

/** Optional self-check (PP1/DP5): started by an explicit click, always skippable, never scored or stored as a grade. */
export function CheckCard({
  question,
  result,
  onAnswer,
  onSkip,
  onOpen,
}: {
  question: CheckQuestion;
  result: CheckResult | null;
  onAnswer: (i: number) => void;
  onSkip: () => void;
  onOpen: (p: string, l: number) => void;
}) {
  const name = useId();
  const [pick, setPick] = useState<number | null>(null);
  return (
    <section className="check" aria-labelledby={`${name}-q`}>
      <h3 className="panel-h">Check yourself</h3>
      <p id={`${name}-q`}>
        <Inline text={question.question} />
      </p>
      <fieldset disabled={result !== null} className="check-options">
        <legend className="sr-only">Answer options</legend>
        {question.options.map((o, i) => (
          <label key={i} className="check-opt">
            <input type="radio" name={name} checked={pick === i} onChange={() => setPick(i)} />
            <Inline text={o} />
          </label>
        ))}
      </fieldset>
      {result ? (
        <div className="check-result" role="status">
          <p>
            <strong>{result.correct ? 'That matches the code.' : 'Not quite; worth another look.'}</strong>{' '}
            <Inline text={result.feedback} />
          </p>
          <p>
            {result.refs.map((r) => (
              <LineRefChip key={`${r.path}:${r.line}`} path={r.path} line={r.line} onOpen={onOpen} />
            ))}
          </p>
          <button type="button" className="btn" onClick={onSkip}>
            Close
          </button>
        </div>
      ) : (
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={pick === null}
            onClick={() => pick !== null && onAnswer(pick)}
          >
            Submit
          </button>
          <button type="button" className="btn" onClick={onSkip}>
            Skip
          </button>
        </div>
      )}
    </section>
  );
}
