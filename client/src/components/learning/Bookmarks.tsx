import { useEffect, useState } from 'react';
import type { BookmarkView } from '@kyc/contracts';
import { api, ApiError } from '../../api/client';
import { EmptyState } from '../ui';

/** The learner's bookmarks in this repository (P3.4). Opening one goes to it in Explore. */
export function Bookmarks({
  repositoryId,
  onOpen,
  compact,
}: {
  repositoryId: string;
  onOpen: (path: string, line: number, label: string) => void;
  /** A short list (Explore's start page) instead of the project section. */
  compact?: boolean;
}) {
  const [items, setItems] = useState<BookmarkView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .bookmarks(repositoryId)
      .then((r) => setItems(r.bookmarks))
      .catch((e: unknown) =>
        // A shared snapshot (not yours) has no bookmarks to show.
        e instanceof ApiError && e.status === 404 ? setItems([]) : setError('Could not load your bookmarks.'),
      );
  }, [repositoryId]);
  if (compact && (!items || items.length === 0)) return null;
  const H = compact ? 'h3' : 'h2';
  return (
    <section className="section" id="bookmarks" aria-labelledby={compact ? 'bm-c-h' : 'bm-h'}>
      <H id={compact ? 'bm-c-h' : 'bm-h'} className={compact ? undefined : 'section-h'}>
        Your bookmarks
      </H>
      {!compact && <p className="section-lede">Places in the code you saved to come back to.</p>}
      {error && <p className="muted">{error}</p>}
      {!error && items && items.length === 0 && (
        <EmptyState title="No bookmarks yet">
          While reading code in Learn or Explore, use Bookmark above the code to save the place.
        </EmptyState>
      )}
      <ul className="start-list">
        {(items ?? []).map((b) => (
          <li key={b.id}>
            <button
              type="button"
              className="link"
              onClick={() => onOpen(b.path, b.startLine ?? 1, b.label ?? b.path.split('/').pop() ?? b.path)}
            >
              {b.label ?? b.path}
            </button>{' '}
            <span className="path">
              {b.path}
              {b.startLine ? `:${b.startLine}` : ''}
            </span>
            <button
              type="button"
              className="btn btn-small btn-quiet"
              aria-label={`Remove bookmark ${b.label ?? b.path}`}
              onClick={() =>
                void api
                  .deleteBookmark(b.id)
                  .then(() => setItems((xs) => (xs ?? []).filter((x) => x.id !== b.id)))
                  .catch(() => setError('Could not remove that bookmark.'))
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Bookmark the current stop. */
export function BookmarkButton({
  repositoryId,
  commitSha,
  stop,
}: {
  repositoryId: string;
  commitSha: string | null;
  stop: { path: string; startLine: number; endLine: number; symbolKey: string | null; label: string };
}) {
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle');
  useEffect(() => setState('idle'), [stop.path, stop.startLine, stop.endLine]);
  return (
    <button
      type="button"
      className="btn btn-small"
      aria-pressed={state === 'saved'}
      onClick={() =>
        void api
          .saveBookmark(repositoryId, {
            path: stop.path,
            symbolKey: stop.symbolKey,
            startLine: stop.startLine,
            endLine: stop.endLine,
            commitSha: commitSha && /^[0-9a-f]{40}$/.test(commitSha) ? commitSha : null,
            label: stop.label,
          })
          .then(() => setState('saved'))
          .catch(() => setState('error'))
      }
    >
      <span aria-hidden="true">{state === 'saved' ? '★' : '☆'}</span>
      {state === 'saved' ? 'Bookmarked' : state === 'error' ? "Couldn't bookmark" : 'Bookmark'}
    </button>
  );
}
