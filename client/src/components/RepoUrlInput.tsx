import { useId, useState, type FormEvent } from 'react';
import { checkRepoUrl } from '../lib/repoUrl';

export function RepoUrlInput({
  value,
  onChange,
  onSubmit,
  submitting,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (url: string) => void;
  submitting: boolean;
  error?: ReactNodeLike;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const check = checkRepoUrl(value);
  const showHint = touched && !check.ok && value.trim().length > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (check.ok) onSubmit(value.trim());
  };
  const describedBy = showHint ? `${id}-hint` : undefined;
  return (
    <form onSubmit={submit} noValidate className="url-form">
      <label htmlFor={id} className="label">
        Public GitHub repository URL
      </label>
      <div className="url-row">
        <input
          id={id}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://github.com/user/project"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={showHint || Boolean(error)}
          aria-describedby={describedBy}
          disabled={submitting}
        />
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Checking…' : 'Analyse repository'}
        </button>
      </div>
      <p id={`${id}-hint`} className="field-hint" aria-live="polite">
        {showHint && !check.ok ? check.hint : ''}
      </p>
      {error}
    </form>
  );
}

type ReactNodeLike = import('react').ReactNode;
