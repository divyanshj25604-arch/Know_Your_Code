import { useState } from 'react';
import { api } from '../api/client';

const REASONS: { v: string; label: string }[] = [
  { v: 'incorrect', label: 'Incorrect' },
  { v: 'too_complex', label: 'Too complex' },
  { v: 'too_basic', label: 'Too basic' },
  { v: 'not_what_i_asked', label: 'Not what I asked' },
  { v: 'other', label: 'Other' },
];

export function FeedbackBar({
  targetType,
  targetId,
}: {
  targetType: 'explanation' | 'message';
  targetId: string;
}) {
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  const send = async (r: 'up' | 'down', reason?: string) => {
    setFailed(false);
    try {
      await api.feedback({ targetType, targetId, rating: r, ...(reason ? { reason } : {}) });
      setSaved(true);
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="feedback" role="group" aria-label="Was this helpful?">
      <span className="muted">Helpful?</span>
      <button
        type="button"
        className={`icon-btn${rating === 'up' ? ' is-on' : ''}`}
        aria-pressed={rating === 'up'}
        onClick={() => {
          setRating('up');
          void send('up');
        }}
      >
        <span aria-hidden="true">👍</span>
        <span className="sr-only">Yes, helpful</span>
      </button>
      <button
        type="button"
        className={`icon-btn${rating === 'down' ? ' is-on' : ''}`}
        aria-pressed={rating === 'down'}
        onClick={() => {
          setRating('down');
          setSaved(false);
          void send('down');
        }}
      >
        <span aria-hidden="true">👎</span>
        <span className="sr-only">No, not helpful</span>
      </button>
      {rating === 'down' && (
        <label className="feedback-reason">
          <span className="sr-only">Why?</span>
          <select defaultValue="" onChange={(e) => e.target.value && void send('down', e.target.value)}>
            <option value="" disabled>
              What was wrong? (optional)
            </option>
            {REASONS.map((r) => (
              <option key={r.v} value={r.v}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="muted" aria-live="polite">
        {saved ? 'Thanks.' : failed ? "Couldn't save that." : ''}
      </span>
    </div>
  );
}
