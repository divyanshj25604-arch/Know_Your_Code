import { useEffect, useId, useRef, useState } from 'react';
import { repoName } from '../lib/repoName';
import { Link } from 'react-router-dom';
import { api, ApiError, type MySnapshot } from '../api/client';
import { PrivacyFacts } from './PrivacyFacts';
import { useHealth } from './Shell';

/**
 * The project switcher (top bar): which repository you are in, your other repositories, opening another one, and
 * managing this one's data (delete, privacy). It replaces the old "Repository menu" so switching never needs a trip
 * back to the landing page.
 */
export function RepoMenu({
  repositoryId,
  snapshotId,
  name,
  partial,
  onDeleted,
}: {
  repositoryId: string;
  snapshotId: string;
  name: string;
  partial?: boolean;
  onDeleted: () => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<MySnapshot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const health = useHealth();

  useEffect(() => {
    if (!open) return;
    if (mine === null)
      api
        .mySnapshots()
        .then((r) => setMine(r.snapshots))
        .catch(() => setMine([]));
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open, mine]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteRepo(repositoryId);
      void api.event('repo_deleted');
      dialog.current?.close();
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message} Try again.` : 'Could not delete. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const others = (mine ?? []).filter((m) => m.snapshotId !== snapshotId);
  return (
    <div className="switcher" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="btn btn-small"
        aria-expanded={open}
        aria-controls={`${id}-pop`}
        onClick={() => setOpen((o) => !o)}
        title="Switch project or manage this repository's data"
      >
        <span className="sr-only">Project: </span>
        <span className="repo-name">{name}</span>
        {partial && (
          <span className="tag tag-warn" title="Some files couldn't be analysed. See the overview.">
            partial
          </span>
        )}
        <span aria-hidden="true" className="muted">
          ▾
        </span>
      </button>
      {open && (
        <div className="popover" id={`${id}-pop`}>
          <p className="eyebrow popover-h">Your repositories</p>
          <Link
            className="menu-item"
            to={`/r/${snapshotId}/project`}
            aria-current="page"
            onClick={() => setOpen(false)}
          >
            <span className="repo-name">{name}</span> <span className="muted small">current</span>
          </Link>
          {mine === null && <p className="muted small popover-h">Loading…</p>}
          {others.map((m) => (
            <Link
              key={m.snapshotId}
              className="menu-item"
              to={`/r/${m.snapshotId}/project`}
              onClick={() => setOpen(false)}
            >
              <span className="repo-name">{repoName(m.repository)}</span>
            </Link>
          ))}
          <Link className="menu-item" to="/start" onClick={() => setOpen(false)}>
            Open another repository <span aria-hidden="true">→</span>
          </Link>
          <hr />
          <details className="menu-sub">
            <summary>About privacy</summary>
            <PrivacyFacts health={health} lead={['Only public repositories can be opened.']} />
          </details>
          <button
            type="button"
            className="menu-item danger"
            onClick={() => {
              setOpen(false);
              dialog.current?.showModal();
            }}
          >
            Delete my data
          </button>
        </div>
      )}
      <dialog ref={dialog} className="dialog" aria-labelledby={`${id}-del`}>
        <h2 id={`${id}-del`}>Delete this repository's data?</h2>
        <p>
          This removes the stored files, analysis, explanations and conversations for{' '}
          <span className="mono">{name}</span>. It can't be undone.
        </p>
        {error && (
          <p role="alert" className="error-title">
            {error}
          </p>
        )}
        <div className="row">
          <button type="button" className="btn btn-danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete everything'}
          </button>
          <button type="button" className="btn" onClick={() => dialog.current?.close()} disabled={busy}>
            Cancel
          </button>
        </div>
      </dialog>
    </div>
  );
}
