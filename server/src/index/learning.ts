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
