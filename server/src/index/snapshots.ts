import type { StageInfo, SnapshotStatus, SnapshotView } from '@kyc/contracts';
import type { Db } from '../db/pool';

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
}

const SELECT = `
  SELECT s.id, s.repository_id, r.gh_owner, r.gh_name, r.owner_id, s.ref, s.commit_sha, s.status, s.stages, s.skipped,
         s.error_code, s.error_message, s.expires_at, s.created_at, s.overview
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
});

export const INITIAL_STAGES: StageInfo[] = [
  { name: 'fetching', state: 'pending' },
  { name: 'filtering', state: 'pending' },
  { name: 'analysing', state: 'pending' },
  { name: 'summarising', state: 'pending' },
];

export async function ensureOwner(db: Db, id: string | null): Promise<string> {
  if (id) {
    const r = await db.query('UPDATE owners SET last_seen_at = now() WHERE id = $1 RETURNING id', [id]);
    if (r.rowCount) return id;
  }
  const r = await db.query<{ id: string }>('INSERT INTO owners DEFAULT VALUES RETURNING id');
  return r.rows[0]!.id;
}

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

export async function createSnapshot(
  db: Db,
  repositoryId: string,
  ref: string | null,
  commitSha: string | null,
  retentionDays: number,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO snapshots (repository_id, ref, commit_sha, status, stages, expires_at)
     VALUES ($1,$2,$3,'queued',$4, now() + make_interval(days => $5)) RETURNING id`,
    [repositoryId, ref, commitSha, JSON.stringify(INITIAL_STAGES), retentionDays],
  );
  const id = r.rows[0]!.id;
  await db.query(`INSERT INTO jobs (snapshot_id, state) VALUES ($1,'queued')`, [id]);
  return id;
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

export async function markFailed(db: Db, id: string, code: string, message: string, stages: StageInfo[]) {
  await db.query(
    `UPDATE snapshots SET status='failed', error_code=$2, error_message=$3, stages=$4 WHERE id=$1`,
    [id, code, message, JSON.stringify(stages)],
  );
  await db.query(`UPDATE jobs SET state='failed', updated_at=now() WHERE snapshot_id=$1`, [id]);
}

export async function markReady(
  db: Db,
  id: string,
  status: 'ready' | 'ready_partial',
  overview: unknown,
  skipped: { path: string; reason: string }[],
  stages: StageInfo[],
  commitSha: string | null,
  contentHash: string | null,
) {
  await db.query(
    `UPDATE snapshots SET status=$2, overview=$3, skipped=$4, stages=$5, commit_sha=COALESCE($6, commit_sha), content_hash=COALESCE($7, content_hash) WHERE id=$1`,
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
  await db.query(`UPDATE jobs SET state='done', updated_at=now() WHERE snapshot_id=$1`, [id]);
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
  const r = await db.query<{ gh_owner: string; gh_name: string }>(
    `SELECT gh_owner, gh_name FROM repositories WHERE id=$1`,
    [repositoryId],
  );
  if (!r.rows[0]) return 0;
  const n = await db.query(`SELECT count(*)::int AS n FROM snapshots WHERE repository_id=$1`, [repositoryId]);
  await db.query('DELETE FROM repositories WHERE id=$1', [repositoryId]); // cascades to everything derived
  await db.query(`INSERT INTO deletion_log (repository_ref, reason) VALUES ($1,$2)`, [
    `${r.rows[0].gh_owner}/${r.rows[0].gh_name}`,
    reason,
  ]);
  return (n.rows[0] as { n: number }).n;
}

/** Delete expired snapshots (and repositories left empty). */
export async function deleteExpired(db: Db): Promise<number> {
  const exp = await db.query<{ id: string; gh_owner: string; gh_name: string; repository_id: string }>(
    `SELECT s.id, s.repository_id, r.gh_owner, r.gh_name FROM snapshots s JOIN repositories r ON r.id=s.repository_id WHERE s.expires_at < now()`,
  );
  for (const row of exp.rows) {
    await db.query('DELETE FROM snapshots WHERE id=$1', [row.id]);
    await db.query(`INSERT INTO deletion_log (repository_ref, reason) VALUES ($1,'retention')`, [
      `${row.gh_owner}/${row.gh_name}`,
    ]);
  }
  await db.query(
    `DELETE FROM repositories r WHERE NOT EXISTS (SELECT 1 FROM snapshots s WHERE s.repository_id = r.id)`,
  );
  return exp.rows.length;
}
