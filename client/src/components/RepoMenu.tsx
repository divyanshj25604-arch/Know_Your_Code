import { useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { PrivacyFacts } from './PrivacyFacts';
import { useHealth } from './Shell';

export function RepoMenu({ repositoryId, onDeleted }: { repositoryId: string; onDeleted: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const health = useHealth();

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

  return (
    <>
      <details className="menu">
        <summary>Repository menu</summary>
        <div className="menu-pop">
          <button type="button" className="menu-item danger" onClick={() => dialog.current?.showModal()}>
            Delete my data
          </button>
          <details className="menu-sub">
            <summary>About privacy</summary>
            <PrivacyFacts health={health} lead={['Only public repositories can be opened.']} />
          </details>
        </div>
      </details>
      <dialog ref={dialog} className="dialog" aria-labelledby="del-h">
        <h2 id="del-h">Delete this repository's data?</h2>
        <p>
          This removes the stored files, analysis, explanations and conversations for this repository. It
          can't be undone.
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
    </>
  );
}
