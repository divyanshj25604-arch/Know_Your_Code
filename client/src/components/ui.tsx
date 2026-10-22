import { useId, type ReactNode } from 'react';
import { ERROR_MESSAGES, type Depth, type ErrorCode } from '@kyc/contracts';
import { Inline } from '../lib/inline';

export function ProvenanceTag({ kind }: { kind: 'verified' | 'explained' | 'pattern' }) {
  const t = {
    verified: { icon: '✓', label: 'Verified', tip: 'Computed from your code by static analysis.' },
    pattern: {
      icon: '✓',
      label: 'Verified (pattern)',
      tip: 'Matched by a known code pattern (for example an Express route). Pattern-based, not proof.',
    },
    explained: {
      icon: '✦',
      label: 'Explained',
      tip: 'An AI interpretation of your code. It can be wrong; check the linked lines.',
    },
  }[kind];
  return (
    <span className={`tag tag-${kind}`} title={t.tip}>
      <span aria-hidden="true">{t.icon}</span> {t.label}
    </span>
  );
}

export function LineRefChip({
  path,
  line,
  onOpen,
}: {
  path: string;
  line: number;
  onOpen: (path: string, line: number) => void;
}) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return (
    <button
      type="button"
      className="chip chip-ref"
      onClick={() => onOpen(path, line)}
      aria-label={`Open ${path} line ${line}`}
      title={`${path}:${line}`}
    >
      {base}:{line}
    </button>
  );
}

export function ConceptChip({
  label,
  onOpen,
  visited,
}: {
  label: string;
  onOpen: () => void;
  visited?: boolean;
}) {
  return (
    <button type="button" className={`chip chip-concept${visited ? ' is-visited' : ''}`} onClick={onOpen}>
      {label}
    </button>
  );
}

export function DepthControl({
  value,
  onChange,
  disabled,
}: {
  value: Depth;
  onChange: (d: Depth) => void;
  disabled?: boolean;
}) {
  const name = useId();
  const opts: { v: Depth; label: string; key: string }[] = [
    { v: 'simpler', label: 'Simpler', key: 'S' },
    { v: 'default', label: 'Default', key: '' },
    { v: 'deeper', label: 'Deeper', key: 'D' },
  ];
  return (
    <fieldset className="depth" disabled={disabled}>
      <legend className="sr-only">Explanation depth</legend>
      {opts.map((o) => (
        <label key={o.v} className={`depth-opt${value === o.v ? ' is-on' : ''}`}>
          <input
            type="radio"
            name={name}
            value={o.v}
            checked={value === o.v}
            onChange={() => onChange(o.v)}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

export function ErrorState({
  code,
  message,
  action,
  onAction,
  actionLabel,
}: {
  code?: ErrorCode;
  message?: string;
  action?: string;
  onAction?: () => void;
  actionLabel?: string;
}) {
  const copy = code ? ERROR_MESSAGES[code] : undefined;
  const text = message || copy?.message || 'Something went wrong.';
  const rawHint = action ?? copy?.action;
  // Don't repeat "Retry" as text when there is already a Retry button.
  const hint =
    rawHint && onAction && rawHint.toLowerCase() === (actionLabel ?? 'Retry').toLowerCase()
      ? undefined
      : rawHint;
  return (
    <div className="error-state" role="alert">
      <p className="error-title">
        <span aria-hidden="true">⚠ </span>
        {text}
      </p>
      {hint && <p className="muted">{hint}</p>}
      {onAction && (
        <button type="button" className="btn" onClick={onAction}>
          {actionLabel ?? 'Retry'}
        </button>
      )}
    </div>
  );
}

export function Banner({ children, tone = 'warning' }: { children: ReactNode; tone?: 'warning' | 'info' }) {
  return (
    <div className={`banner banner-${tone}`} role="status">
      {children}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-line" style={{ width: `${90 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

export function TextWithRefs({
  text,
  refs,
  onOpen,
}: {
  text: string;
  refs?: { path: string; line: number }[];
  onOpen: (p: string, l: number) => void;
}) {
  return (
    <p>
      <Inline text={text} />{' '}
      {(refs ?? []).map((r) => (
        <LineRefChip key={`${r.path}:${r.line}`} path={r.path} line={r.line} onOpen={onOpen} />
      ))}
    </p>
  );
}
