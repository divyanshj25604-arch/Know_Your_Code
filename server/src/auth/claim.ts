import type pg from 'pg';
import { withTx, type Db } from '../db/pool';
import { relinkExplanationSymbols } from '../index/runs';

export interface ClaimResult {
  repositories: number;
  snapshots: number;
  explanations: number;
}

/** How much anonymous work a browser holds (shown after sign-in so the client can offer to keep it). */
export async function claimableRepositories(db: Db, anonymousUserId: string): Promise<number> {
  const r = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM repositories r JOIN users u ON u.id = r.owner_id
     WHERE r.owner_id=$1 AND u.kind='anonymous'`,
    [anonymousUserId],
  );
  return r.rows[0]?.n ?? 0;
}

/**
 * Move everything an anonymous user owns into a registered account, then delete the anonymous user. One transaction:
 * either all of it moves or nothing does. Authorisation is the caller's job: it must hold both the account's session
 * and the anonymous user's signed cookie (proof of being that browser).
 *
 * A repository only the anonymous user has simply changes owner; the composite foreign keys carry its explanations,
 * progress, bookmarks, annotations and positions with it. A repository both have is merged into the account's row:
 *  - a snapshot of a commit the account also has is dropped (code only) after its explanations are re-pointed to
 *    the account's snapshot and re-linked to the same symbols by stable key;
 *  - other snapshots, and history whose snapshot already expired, move across;
 *  - progress keeps the furthest status, duplicate bookmarks collapse, and each position track keeps the newer one.
 *
 * Returns null when there is nothing to claim (the anonymous user is gone or is not anonymous), which also makes a
 * repeated claim a harmless no-op.
 */
export async function claimAnonymousData(
  db: Db,
  anonymousUserId: string,
  accountId: string,
): Promise<ClaimResult | null> {
  if (anonymousUserId === accountId) return null;
  return withTx(db, async (c) => {
    // Lock both users in a fixed order so concurrent claims cannot deadlock or double-move rows.
    const locked = await c.query<{ id: string; kind: string }>(
      'SELECT id, kind FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [[anonymousUserId, accountId]],
    );
    const kindOf = (id: string) => locked.rows.find((r) => r.id === id)?.kind;
    if (kindOf(anonymousUserId) !== 'anonymous' || kindOf(accountId) !== 'registered') return null;
    // Repository and its learning rows move in several statements; check the (repository, owner) keys at commit.
    await c.query('SET CONSTRAINTS ALL DEFERRED');

    const explanations = await countOwned(c, 'explanations', anonymousUserId);
    const result: ClaimResult = { repositories: 0, snapshots: 0, explanations };
    const repos = await c.query<{ id: string; gh_owner: string; gh_name: string }>(
      'SELECT id, gh_owner, gh_name FROM repositories WHERE owner_id=$1 ORDER BY id FOR UPDATE',
      [anonymousUserId],
    );
    for (const repo of repos.rows) {
      result.repositories++;
      result.snapshots += await moveRepository(c, repo, anonymousUserId, accountId);
    }
    // Rows owned directly by the user rather than through a repository.
    await c.query('UPDATE feedback SET owner_id=$2 WHERE owner_id=$1', [anonymousUserId, accountId]);
    await c.query('UPDATE events SET owner_id=$2 WHERE owner_id=$1', [anonymousUserId, accountId]);
    // The cost ledger has no foreign key; keep per-user spend attributed to the person, not the old browser.
    await c.query('UPDATE llm_calls SET owner_id=$2 WHERE owner_id=$1', [anonymousUserId, accountId]);
    await c.query('DELETE FROM users WHERE id=$1', [anonymousUserId]);
    return result;
  });
}

async function countOwned(c: pg.PoolClient, table: 'explanations', ownerId: string): Promise<number> {
  const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE owner_id=$1`, [
    ownerId,
  ]);
  return r.rows[0]?.n ?? 0;
}

/** Move one repository to the account. Returns how many snapshots changed hands (duplicates dropped excluded). */
async function moveRepository(
  c: pg.PoolClient,
  repo: { id: string; gh_owner: string; gh_name: string },
  anonId: string,
  accountId: string,
): Promise<number> {
  const existing = await c.query<{ id: string }>(
    'SELECT id FROM repositories WHERE owner_id=$1 AND gh_owner=$2 AND gh_name=$3 FOR UPDATE',
    [accountId, repo.gh_owner, repo.gh_name],
  );
  const target = existing.rows[0]?.id;
  if (!target) {
    // ON UPDATE CASCADE carries (repository_id, owner) into explanations, progress, bookmarks, annotations and positions.
    await c.query('UPDATE repositories SET owner_id=$2 WHERE id=$1', [repo.id, accountId]);
    const n = await c.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM snapshots WHERE repository_id=$1',
      [repo.id],
    );
    return n.rows[0]?.n ?? 0;
  }
  const moved = await mergeSnapshots(c, repo.id, target, accountId);
  // Explanations whose snapshot moved were re-pointed by the cascade; the rest (expired history) move here.
  await c.query(
    `UPDATE explanations SET repository_id=$3, owner_id=$4
     WHERE owner_id=$1 AND repository_id IN ($2, $3)`,
    [anonId, repo.id, target, accountId],
  );
  await mergeProgress(c, repo.id, anonId, target, accountId);
  await mergeBookmarks(c, repo.id, anonId, target, accountId);
  // Annotations never collide (several notes per target are allowed): all of them move.
  await c.query('UPDATE annotations SET user_id=$3, repository_id=$4 WHERE user_id=$1 AND repository_id=$2', [
    anonId,
    repo.id,
    accountId,
    target,
  ]);
  await mergePositions(c, repo.id, anonId, target, accountId);
  await c.query('DELETE FROM repositories WHERE id=$1', [repo.id]);
  return moved;
}

async function mergeSnapshots(
  c: pg.PoolClient,
  from: string,
  target: string,
  accountId: string,
): Promise<number> {
  let moved = 0;
  const snaps = await c.query<{ id: string; commit_sha: string | null }>(
    'SELECT id, commit_sha FROM snapshots WHERE repository_id=$1 ORDER BY id FOR UPDATE',
    [from],
  );
  for (const s of snaps.rows) {
    const twin = s.commit_sha
      ? (
          await c.query<{ id: string }>('SELECT id FROM snapshots WHERE repository_id=$1 AND commit_sha=$2', [
            target,
            s.commit_sha,
          ])
        ).rows[0]?.id
      : undefined;
    if (twin) {
      // Same commit, same code: keep the account's snapshot and re-link to its symbols by stable key.
      await c.query(
        `UPDATE explanations SET snapshot_id=$2, repository_id=$3, owner_id=$4, symbol_id=NULL WHERE snapshot_id=$1`,
        [s.id, twin, target, accountId],
      );
      await relinkExplanationSymbols(c, twin);
      await c.query('DELETE FROM snapshots WHERE id=$1', [s.id]);
    } else {
      // ON UPDATE CASCADE moves the snapshot's explanations into the target repository with it.
      await c.query('UPDATE snapshots SET repository_id=$2 WHERE id=$1', [s.id, target]);
      moved++;
    }
  }
  return moved;
}

async function mergeProgress(
  c: pg.PoolClient,
  from: string,
  anonId: string,
  target: string,
  accountId: string,
) {
  await c.query(
    `UPDATE learning_progress acc SET
       status = CASE WHEN acc.status = 'completed' OR a.status = 'completed' THEN 'completed' ELSE 'started' END,
       completed_at = LEAST(acc.completed_at, a.completed_at),
       first_seen_at = LEAST(acc.first_seen_at, a.first_seen_at),
       updated_at = GREATEST(acc.updated_at, a.updated_at)
     FROM learning_progress a
     WHERE a.user_id=$1 AND a.repository_id=$2 AND acc.user_id=$4 AND acc.repository_id=$3
       AND acc.subject_kind = a.subject_kind AND acc.subject_key = a.subject_key`,
    [anonId, from, target, accountId],
  );
  await c.query(
    `DELETE FROM learning_progress a USING learning_progress acc
     WHERE a.user_id=$1 AND a.repository_id=$2 AND acc.user_id=$4 AND acc.repository_id=$3
       AND acc.subject_kind = a.subject_kind AND acc.subject_key = a.subject_key`,
    [anonId, from, target, accountId],
  );
  await c.query(
    'UPDATE learning_progress SET user_id=$3, repository_id=$4 WHERE user_id=$1 AND repository_id=$2',
    [anonId, from, accountId, target],
  );
}

async function mergeBookmarks(
  c: pg.PoolClient,
  from: string,
  anonId: string,
  target: string,
  accountId: string,
) {
  await c.query(
    `DELETE FROM bookmarks a USING bookmarks acc
     WHERE a.user_id=$1 AND a.repository_id=$2 AND acc.user_id=$4 AND acc.repository_id=$3
       AND acc.path = a.path AND COALESCE(acc.symbol_key, '') = COALESCE(a.symbol_key, '')
       AND COALESCE(acc.start_line, 0) = COALESCE(a.start_line, 0)
       AND COALESCE(acc.end_line, 0) = COALESCE(a.end_line, 0)`,
    [anonId, from, target, accountId],
  );
  await c.query('UPDATE bookmarks SET user_id=$3, repository_id=$4 WHERE user_id=$1 AND repository_id=$2', [
    anonId,
    from,
    accountId,
    target,
  ]);
}

async function mergePositions(
  c: pg.PoolClient,
  from: string,
  anonId: string,
  target: string,
  accountId: string,
) {
  // Per track, the more recently updated position wins.
  await c.query(
    `DELETE FROM learner_positions acc USING learner_positions a
     WHERE a.user_id=$1 AND a.repository_id=$2 AND acc.user_id=$4 AND acc.repository_id=$3
       AND acc.track = a.track AND a.updated_at > acc.updated_at`,
    [anonId, from, target, accountId],
  );
  await c.query(
    `DELETE FROM learner_positions a USING learner_positions acc
     WHERE a.user_id=$1 AND a.repository_id=$2 AND acc.user_id=$4 AND acc.repository_id=$3 AND acc.track = a.track`,
    [anonId, from, target, accountId],
  );
  await c.query(
    'UPDATE learner_positions SET user_id=$3, repository_id=$4 WHERE user_id=$1 AND repository_id=$2',
    [anonId, from, accountId, target],
  );
}
