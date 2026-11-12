import { useState } from 'react';
import type { AnnotationView } from '@kyc/contracts';
import type { Annotations } from './useExploreData';
import type { noteTarget } from './graphModel';

type NoteTarget = NonNullable<ReturnType<typeof noteTarget>>;

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function NoteItem({
  a,
  ann,
  onOpen,
  showTarget,
}: {
  a: AnnotationView;
  ann: Annotations;
  onOpen: (a: AnnotationView) => void;
  showTarget: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(a.body);
  return (
    <li className="note-item" aria-label={`Note on ${a.targetLabel}`}>
      {showTarget && (
        <button type="button" className="code-cite" onClick={() => onOpen(a)}>
          <span>{a.targetLabel}</span>
          {a.path && (
            <span className="path">
              {a.path}
              {a.startLine ? `:${a.startLine}` : ''}
            </span>
          )}
        </button>
      )}
      {editing ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void ann.update(a.id, text.trim()).then(
              () => setEditing(false),
              () => undefined,
            );
          }}
        >
          <label className="sr-only" htmlFor={`edit-${a.id}`}>
            Edit note
          </label>
          <textarea
            id={`edit-${a.id}`}
            rows={3}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row">
            <button type="submit" className="btn btn-small" disabled={ann.busy || !text.trim()}>
              Save
            </button>
            <button type="button" className="btn btn-small btn-quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="note-body">{a.body}</p>
          <p className="row small muted">
            <span>{when(a.updatedAt)}</span>
            {!showTarget && a.path && (
              <button type="button" className="link small" onClick={() => onOpen(a)}>
                Open the code
              </button>
            )}
            <button type="button" className="link small" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className="link small"
              onClick={() => void ann.remove(a.id).catch(() => undefined)}
              disabled={ann.busy}
            >
              Delete
            </button>
          </p>
        </>
      )}
    </li>
  );
}

/**
 * Notes on graph entities: the notes on what is selected (a module, file, function, relationship or flow step), a box
 * to add one, and every note in this repository. Notes are saved on the server against the entity's stable key, so
 * they come back on the same node after a reload or a re-import of the same code.
 */
export function NotesPanel({
  ann,
  target,
  commitSha,
  onOpen,
}: {
  ann: Annotations;
  target: NoteTarget | null;
  commitSha: string | null;
  onOpen: (a: AnnotationView) => void;
}) {
  const [text, setText] = useState('');
  const [all, setAll] = useState(false);
  if (ann.status === 'unavailable')
    return (
      <p className="small muted">
        Notes are private to the repository's owner and aren't shown on shared links.
      </p>
    );
  if (ann.status === 'error')
    return <p className="note">Your notes couldn't be loaded. Reload to try again.</p>;
  const mine = target
    ? ann.list.filter((a) => a.targetKind === target.kind && a.targetKey === target.key)
    : [];
  return (
    <div className="notes" aria-label="Notes">
      {target ? (
        <>
          <p className="small">
            Notes on <strong>{target.label}</strong>
          </p>
          {mine.length > 0 && (
            <ul className="bare-list stack" aria-label="Notes on the selection">
              {mine.map((a) => (
                <NoteItem key={a.id} a={a} ann={ann} onOpen={onOpen} showTarget={false} />
              ))}
            </ul>
          )}
          <form
            className="note-form"
            onSubmit={(e) => {
              e.preventDefault();
              const body = text.trim();
              if (!body) return;
              void ann
                .create({
                  targetKind: target.kind,
                  targetKey: target.key,
                  targetLabel: target.label.slice(0, 300),
                  path: target.path,
                  startLine: target.line,
                  endLine: target.line,
                  commitSha,
                  body,
                })
                .then(
                  () => setText(''),
                  () => undefined,
                );
            }}
          >
            <label htmlFor="note-new" className="sr-only">
              Add a note about {target.label}
            </label>
            <textarea
              id="note-new"
              rows={2}
              maxLength={2000}
              placeholder={`What do you want to remember about ${target.label}?`}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="btn btn-small" disabled={ann.busy || !text.trim()}>
              Add note
            </button>
          </form>
        </>
      ) : (
        <p className="small muted">
          Select a module, file, function, relationship or flow step to add a note to it.
        </p>
      )}
      {ann.error && (
        <p className="note" role="alert">
          {ann.error}
        </p>
      )}
      {ann.list.length > 0 && (
        <details open={all} onToggle={(e) => setAll((e.target as HTMLDetailsElement).open)}>
          <summary className="small">All notes in this repository ({ann.list.length})</summary>
          <ul className="bare-list stack" aria-label="All notes">
            {ann.list.map((a) => (
              <NoteItem key={a.id} a={a} ann={ann} onOpen={onOpen} showTarget />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
