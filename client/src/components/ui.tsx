import { useId, type ReactNode } from 'react';
import { ERROR_MESSAGES, type Depth, type ErrorCode } from '@kyc/contracts';
import { Inline } from '../lib/inline';

/**
 * Confidence, always as glyph + word + border style (never colour alone), in the brand kit's three states: Verified
 * (parser fact), Likely (a recognised pattern, or the model's reading of cited code), Not sure (not followed; say why).
 */
export function ProvenanceTag({ kind }: { kind: 'verified' | 'explained' | 'pattern' | 'unknown' }) {
  const t = {
    verified: { icon: '✓', label: 'Verified', tip: 'Computed from your code by static analysis.' },
    pattern: {
      icon: '◐',
      label: 'Likely',
      tip: 'Matched by a known code pattern (for example an Express route). Pattern-based, not proof.',
    },
    explained: {
      icon: '◐',
      label: 'Likely',
      tip: "The model's reading of the cited code. It can be wrong; check the linked lines.",
    },
    unknown: {
      icon: '?',
      label: 'Not sure',
      tip: "The analysis couldn't follow this. The reason is shown next to it.",
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
        <span className="glyph" aria-hidden="true">
          ✕{' '}
        </span>
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

/** Page heading block: an eyebrow (where you are), the title, and one sentence on what this page is for. */
export function PageHeader({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
      {children}
    </header>
  );
}

/** An empty state: what is missing, why, and one way forward. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="row">{action}</div>}
    </div>
  );
}

/** Progress in words and as a bar. The words carry the meaning; the bar only repeats it. */
export function ProgressMeter({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="meter">
      <div className="meter-label">
        <span>{label}</span>
        <span>
          {value} of {total}
        </span>
      </div>
      <div
        className="meter-bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={value}
      >
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The onboarding steps (choose, analyse, your project): where the user is in getting started. */
export function OnboardSteps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['Choose a repository', 'Analyse', 'Your project'];
  return (
    <ol className="onboard-steps" aria-label="Getting started">
      {steps.map((s, i) => (
        <li
          key={s}
          className={i + 1 < current ? 'is-done' : undefined}
          aria-current={i + 1 === current ? 'step' : undefined}
        >
          <span className="num" aria-hidden="true">
            {i + 1 < current ? '✓' : i + 1}
          </span>
          {s}
          {i + 1 < current && <span className="sr-only"> (done)</span>}
        </li>
      ))}
    </ol>
  );
}
