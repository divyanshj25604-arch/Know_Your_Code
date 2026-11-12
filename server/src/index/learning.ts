import type { LearnerPositionView, LearnerTrack } from '@kyc/contracts';
import type { Db } from '../db/pool';

/** Learner positions (P2.1): one per user, repository and track. Rows are always scoped by user id. */
interface Row {
  track: LearnerTrack;
  path: string | null;
  symbol_key: string | null;
  start_line: number | null;
  end_line: number | null;
  commit_sha: string | null;
  state: Record<string, unknown>;
  updated_at: Date;
}

const view = (r: Row): LearnerPositionView => ({
  path: r.path,
  symbolKey: r.symbol_key,
  startLine: r.start_line,
  endLine: r.end_line,
  commitSha: r.commit_sha,
  state: r.state,
  updatedAt: r.updated_at.toISOString(),
});

export async function getPositions(db: Db, userId: string, repositoryId: string) {
  const r = await db.query<Row>(
    `SELECT track, path, symbol_key, start_line, end_line, commit_sha, state, updated_at
     FROM learner_positions WHERE user_id=$1 AND repository_id=$2`,
    [userId, repositoryId],
  );
  const by = (t: LearnerTrack) => {
    const row = r.rows.find((x) => x.track === t);
    return row ? view(row) : null;
  };
  return { learning: by('learning'), exploration: by('exploration') };
}

export async function savePosition(
  db: Db,
  userId: string,
  repositoryId: string,
  track: LearnerTrack,
  p: Omit<LearnerPositionView, 'updatedAt'>,
): Promise<LearnerPositionView> {
  const r = await db.query<Row>(
    `INSERT INTO learner_positions (user_id, repository_id, track, path, symbol_key, start_line, end_line, commit_sha, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (user_id, repository_id, track) DO UPDATE SET
       path=EXCLUDED.path, symbol_key=EXCLUDED.symbol_key, start_line=EXCLUDED.start_line, end_line=EXCLUDED.end_line,
       commit_sha=EXCLUDED.commit_sha, state=EXCLUDED.state, updated_at=now()
     RETURNING track, path, symbol_key, start_line, end_line, commit_sha, state, updated_at`,
    [
      userId,
      repositoryId,
      track,
      p.path,
      p.symbolKey,
      p.startLine,
      p.endLine,
      p.commitSha,
      JSON.stringify(p.state),
    ],
  );
  return view(r.rows[0]!);
}

/** The repository if this user owns it (positions are personal: anyone else gets NOT_FOUND). */
export async function ownsRepository(db: Db, userId: string, repositoryId: string): Promise<boolean> {
  const r = await db.query('SELECT 1 FROM repositories WHERE id=$1 AND owner_id=$2', [repositoryId, userId]);
  return (r.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------- bookmarks (P3.4)

interface BookmarkRow {
  id: string;
  path: string;
  symbol_key: string | null;
  start_line: number | null;
  end_line: number | null;
  commit_sha: string | null;
  label: string | null;
  note: string | null;
  created_at: Date;
}

const bookmarkView = (r: BookmarkRow) => ({
  id: r.id,
  path: r.path,
  symbolKey: r.symbol_key,
  startLine: r.start_line,
  endLine: r.end_line,
  commitSha: r.commit_sha,
  label: r.label,
  note: r.note,
  createdAt: r.created_at.toISOString(),
});

const BOOKMARK_COLS = 'id, path, symbol_key, start_line, end_line, commit_sha, label, note, created_at';

export async function listBookmarks(db: Db, userId: string, repositoryId: string) {
  const r = await db.query<BookmarkRow>(
    `SELECT ${BOOKMARK_COLS} FROM bookmarks WHERE user_id=$1 AND repository_id=$2 ORDER BY created_at DESC, id`,
    [userId, repositoryId],
  );
  return r.rows.map(bookmarkView);
}

/** Create a bookmark; the same anchor bookmarked again updates its label and note instead of duplicating. */
export async function saveBookmark(
  db: Db,
  userId: string,
  repositoryId: string,
  b: {
    path: string;
    symbolKey: string | null;
    startLine: number | null;
    endLine: number | null;
    commitSha: string | null;
    label: string | null;
    note: string | null;
  },
) {
  const r = await db.query<BookmarkRow & { created: boolean }>(
    `INSERT INTO bookmarks (user_id, repository_id, path, symbol_key, start_line, end_line, commit_sha, label, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (user_id, repository_id, md5(path), md5(COALESCE(symbol_key, '')), COALESCE(start_line, 0),
                  COALESCE(end_line, 0))
     DO UPDATE SET label=COALESCE(EXCLUDED.label, bookmarks.label), note=COALESCE(EXCLUDED.note, bookmarks.note),
                   commit_sha=COALESCE(EXCLUDED.commit_sha, bookmarks.commit_sha), updated_at=now()
     RETURNING ${BOOKMARK_COLS}, (xmax = 0) AS created`,
    [userId, repositoryId, b.path, b.symbolKey, b.startLine, b.endLine, b.commitSha, b.label, b.note],
  );
  const row = r.rows[0]!;
  return { bookmark: bookmarkView(row), created: row.created };
}

export async function deleteBookmark(db: Db, userId: string, bookmarkId: string): Promise<boolean> {
  const r = await db.query('DELETE FROM bookmarks WHERE id=$1 AND user_id=$2', [bookmarkId, userId]);
  return (r.rowCount ?? 0) > 0;
}
