import type { StageInfo, SnapshotStatus, SnapshotView } from '@kyc/contracts';
import { withTx, type Db, type Queryable } from '../db/pool';

export interface SnapshotRow {
  id: string;
  repositoryId: string;
  owner: string;
  name: string;
  ref: string | null;
  commitSha: string | null;
  status: SnapshotStatus;
  stages: StageInfo[];
  skipped: { path: string; reason: string }[];
  errorCode: string | null;
  errorMessage: string | null;
  expiresAt: Date;
  createdAt: Date;
  ownerId: string;
  overview: unknown;
  /** Share tokens issued at or before this instant are invalid (P1.5). */
  sharesRevokedAt: Date | null;
}

const SELECT = `
  SELECT s.id, s.repository_id, r.gh_owner, r.gh_name, r.owner_id, s.ref, s.commit_sha, s.status, s.stages, s.skipped,
         s.error_code, s.error_message, s.expires_at, s.created_at, s.overview, s.shares_revoked_at
  FROM snapshots s JOIN repositories r ON r.id = s.repository_id`;

interface Raw {
  id: string;
  repository_id: string;
  gh_owner: string;
  gh_name: string;
  owner_id: string;
  ref: string | null;
  commit_sha: string | null;
  status: SnapshotStatus;
  stages: StageInfo[];
  skipped: { path: string; reason: string }[];
  error_code: string | null;
  error_message: string | null;
  expires_at: Date;
  created_at: Date;
  overview: unknown;
  shares_revoked_at: Date | null;
}

const map = (r: Raw): SnapshotRow => ({
  id: r.id,
  repositoryId: r.repository_id,
  owner: r.gh_owner,
  name: r.gh_name,
  ownerId: r.owner_id,
  ref: r.ref,
  commitSha: r.commit_sha,
  status: r.status,
  stages: r.stages,
  skipped: r.skipped,
  errorCode: r.error_code,
  errorMessage: r.error_message,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
  overview: r.overview,
  sharesRevokedAt: r.shares_revoked_at,
});

export const INITIAL_STAGES: StageInfo[] = [
  { name: 'fetching', state: 'pending' },
  { name: 'filtering', state: 'pending' },
  { name: 'analysing', state: 'pending' },
  { name: 'summarising', state: 'pending' },
];

export async function upsertRepository(
  db: Db,
  ownerId: string,
  ghOwner: string,
  ghName: string,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO repositories (owner_id, gh_owner, gh_name) VALUES ($1,$2,$3)
     ON CONFLICT (owner_id, gh_owner, gh_name) DO UPDATE SET gh_name = EXCLUDED.gh_name RETURNING id`,
    [ownerId, ghOwner, ghName],
  );
  return r.rows[0]!.id;
}

export type CreateOutcome =
  /** A new snapshot and job were written: enqueue it. */
  | 'created'
  /** An earlier failed or expired snapshot of the same commit was reset to queued: enqueue it. */
  | 'requeued'
  /** The same commit is already queued, being processed, or ready: do not run it again. */
  | 'existing';

/**
 * Create the snapshot and its job atomically. For a commit that already has a snapshot (the unique
 * `(repository_id, commit_sha)` index), a failed or expired one is reset for a fresh run (error cleared, stages
 * reset, expiry refreshed, job re-queued); an in-progress or live one is returned untouched so it never runs twice.
 */
export async function createSnapshot(
  db: Db,
  repositoryId: string,
  ref: string | null,
  commitSha: string | null,
  retentionDays: number,
): Promise<{ id: string; outcome: CreateOutcome }> {
  return withTx(db, async (c) => {
    const ins = await c.query<{ id: string }>(
      `INSERT INTO snapshots (repository_id, ref, commit_sha, status, stages, expires_at)
       VALUES ($1,$2,$3,'queued',$4, now() + make_interval(days => $5))
       ON CONFLICT (repository_id, commit_sha) WHERE commit_sha IS NOT NULL DO NOTHING RETURNING id`,
      [repositoryId, ref, commitSha, JSON.stringify(INITIAL_STAGES), retentionDays],
    );
    if (ins.rows[0]) {
      const id = ins.rows[0].id;
      await c.query(`INSERT INTO jobs (snapshot_id, state) VALUES ($1,'queued')`, [id]);
      return { id, outcome: 'created' as const };
    }
    // Same commit already has a snapshot (a double click, or an earlier import). Lock it while deciding.
    const cur = await c.query<{ id: string; status: SnapshotStatus; expired: boolean }>(
      `SELECT id, status, expires_at < now() AS expired FROM snapshots
       WHERE repository_id=$1 AND commit_sha=$2 FOR UPDATE`,
      [repositoryId, commitSha],
    );
    const row = cur.rows[0];
    if (!row) throw new Error('snapshot conflict without a conflicting row');
    if (row.status !== 'failed' && !row.expired) return { id: row.id, outcome: 'existing' as const };
    await c.query(
      `UPDATE snapshots SET status='queued', stages=$2, error_code=NULL, error_message=NULL,
         expires_at = now() + make_interval(days => $3)
       WHERE id=$1`,
      [row.id, JSON.stringify(INITIAL_STAGES), retentionDays],
    );
    await c.query(
      `INSERT INTO jobs (snapshot_id, state) VALUES ($1,'queued')
       ON CONFLICT (snapshot_id) DO UPDATE SET state='queued', attempts=0, last_error=NULL, updated_at=now()`,
      [row.id],
    );
    return { id: row.id, outcome: 'requeued' as const };
  });
}

/** A ready snapshot for the same repository and commit, if any (idempotent import, docs/01 FR-IMP-02). */
export async function findReusable(db: Db, repositoryId: string, commitSha: string): Promise<string | null> {
  const r = await db.query<{ id: string }>(
    `SELECT id FROM snapshots WHERE repository_id=$1 AND commit_sha=$2 AND status IN ('ready','ready_partial') AND expires_at > now() LIMIT 1`,
    [repositoryId, commitSha],
  );
  return r.rows[0]?.id ?? null;
}

export async function getSnapshot(db: Db, id: string): Promise<SnapshotRow | null> {
  const r = await db.query<Raw>(`${SELECT} WHERE s.id = $1`, [id]);
  return r.rows[0] ? map(r.rows[0]) : null;
}

export async function setStatus(db: Db, id: string, status: SnapshotStatus, stages?: StageInfo[]) {
  if (stages)
    await db.query('UPDATE snapshots SET status=$2, stages=$3 WHERE id=$1', [
      id,
      status,
      JSON.stringify(stages),
    ]);
  else await db.query('UPDATE snapshots SET status=$2 WHERE id=$1', [id, status]);
}

export async function setStages(db: Db, id: string, stages: StageInfo[]) {
  await db.query('UPDATE snapshots SET stages=$2 WHERE id=$1', [id, JSON.stringify(stages)]);
}

/** Longest internal error kept in `jobs.last_error` (operators only; never returned by the API). */
const LAST_ERROR_MAX = 500;

export async function markFailed(
  q: Queryable,
  id: string,
  code: string,
  message: string,
  stages: StageInfo[],
  internalError: string,
) {
  await q.query(
    `UPDATE snapshots SET status='failed', error_code=$2, error_message=$3, stages=$4 WHERE id=$1`,
    [id, code, message, JSON.stringify(stages)],
  );
  await q.query(`UPDATE jobs SET state='failed', last_error=$2, updated_at=now() WHERE snapshot_id=$1`, [
    id,
    internalError.slice(0, LAST_ERROR_MAX),
  ]);
}

export async function markReady(
  q: Queryable,
  id: string,
  status: 'ready' | 'ready_partial',
  overview: unknown,
  skipped: { path: string; reason: string }[],
  stages: StageInfo[],
  commitSha: string | null,
  contentHash: string | null,
) {
  await q.query(
    `UPDATE snapshots SET status=$2, overview=$3, skipped=$4, stages=$5, error_code=NULL, error_message=NULL,
       commit_sha=COALESCE($6, commit_sha), content_hash=COALESCE($7, content_hash) WHERE id=$1`,
    [
      id,
      status,
      JSON.stringify(overview),
      JSON.stringify(skipped),
      JSON.stringify(stages),
      commitSha,
      contentHash,
    ],
  );
  await q.query(`UPDATE jobs SET state='done', last_error=NULL, updated_at=now() WHERE snapshot_id=$1`, [id]);
}

export function toView(s: SnapshotRow): SnapshotView {
  const expired = s.expiresAt.getTime() < Date.now();
  return {
    id: s.id,
    repositoryId: s.repositoryId,
    repository: { owner: s.owner, name: s.name },
    commitSha: s.commitSha,
    status: expired && s.status !== 'failed' ? 'expired' : s.status,
    stages: s.stages,
    skippedCount: s.skipped.length,
    error: s.errorCode ? { code: s.errorCode, message: s.errorMessage ?? '' } : null,
    expiresAt: s.expiresAt.toISOString(),
  };
}

/** Delete one repository and everything derived from it. Returns "owner/name" for the audit log (no content). */
export async function deleteRepository(
  db: Db,
  repositoryId: string,
  reason: 'user' | 'retention',
): Promise<number> {
  return withTx(db, async (c) => {
    const r = await c.query<{ gh_owner: string; gh_name: string }>(
      `SELECT gh_owner, gh_name FROM repositories WHERE id=$1 FOR UPDATE`,
      [repositoryId],
    );
    if (!r.rows[0]) return 0;
    const n = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM snapshots WHERE repository_id=$1`,
      [repositoryId],
    );
    await c.query('DELETE FROM repositories WHERE id=$1', [repositoryId]); // cascades to everything derived
    await c.query(`INSERT INTO deletion_log (repository_ref, reason) VALUES ($1,$2)`, [
      `${r.rows[0].gh_owner}/${r.rows[0].gh_name}`,
      reason,
    ]);
    return n.rows[0]?.n ?? 0;
  });
}

/** Delete expired snapshots: code only. Learning history stays (explanations keep a null snapshot link). */
export async function deleteExpired(db: Db): Promise<number> {
  const exp = await db.query<{ id: string; gh_owner: string; gh_name: string; repository_id: string }>(
    `SELECT s.id, s.repository_id, r.gh_owner, r.gh_name FROM snapshots s JOIN repositories r ON r.id=s.repository_id WHERE s.expires_at < now()`,
  );
  let deleted = 0;
  for (const row of exp.rows) {
    // Re-check expiry at delete time: a re-import may have reset and refreshed this snapshot since the SELECT.
    await withTx(db, async (c) => {
      const d = await c.query('DELETE FROM snapshots WHERE id=$1 AND expires_at < now()', [row.id]);
      if (!d.rowCount) return;
      await c.query(`INSERT INTO deletion_log (repository_ref, reason) VALUES ($1,'retention')`, [
        `${row.gh_owner}/${row.gh_name}`,
      ]);
      deleted++;
    });
  }
  // A repository row holds no code; once its snapshots are gone it is kept only as the anchor of learning history.
  await db.query(
    `DELETE FROM repositories r
     WHERE NOT EXISTS (SELECT 1 FROM snapshots s WHERE s.repository_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM explanations e WHERE e.repository_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM learning_progress p WHERE p.repository_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM bookmarks b WHERE b.repository_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM learner_positions l WHERE l.repository_id = r.id)`,
  );
  return deleted;
}

/**
 * Invalidate every share token issued for this snapshot so far. The instant comes from the application clock, the
 * same clock that stamps tokens, so database/app clock skew can never revoke a token issued after this call.
 */
export async function revokeShares(db: Db, snapshotId: string, at: Date = new Date()): Promise<void> {
  await db.query('UPDATE snapshots SET shares_revoked_at = $2 WHERE id=$1', [snapshotId, at]);
}
