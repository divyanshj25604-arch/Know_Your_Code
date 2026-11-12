import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/pool';
import { deleteExpired } from '../index/snapshots';
import { deleteEndedSessions } from '../auth/store';

/**
 * Delete expired code (7-day snapshot retention) and trim operational tables that must not keep data forever.
 * Learning history (explanations, progress, bookmarks, annotations, positions) is kept for registered accounts.
 */
export async function runRetention(db: Db, log: FastifyBaseLogger): Promise<{ snapshots: number }> {
  const snapshots = await deleteExpired(db);
  // Cost and event rows carry no code, but are kept 90 days only.
  await db.query(`DELETE FROM llm_calls WHERE created_at < now() - interval '90 days'`);
  await db.query(`DELETE FROM events WHERE created_at < now() - interval '90 days'`);
  await db.query(`DELETE FROM deletion_log WHERE deleted_at < now() - interval '90 days'`);
  // Anonymous users idle for 30 days whose code has expired are removed with their learning history: an anonymous
  // identity lives in one browser cookie and cannot be recovered once lost. Registered accounts are never removed.
  await db.query(
    `DELETE FROM users u WHERE u.kind = 'anonymous' AND u.last_seen_at < now() - interval '30 days'
       AND NOT EXISTS (
         SELECT 1 FROM snapshots s JOIN repositories r ON r.id = s.repository_id WHERE r.owner_id = u.id)`,
  );
  await deleteEndedSessions(db);
  // Budget reservations left behind by a crashed request (they already stopped counting when they expired).
  await db.query('DELETE FROM ai_reservations WHERE expires_at < now()');
  if (snapshots) log.info({ snapshots }, 'retention: deleted expired snapshots');
  return { snapshots };
}

/** Run once at start-up and then hourly. The timer never keeps the process alive. */
export function scheduleRetention(db: Db, log: FastifyBaseLogger, everyMs = 3600_000): () => void {
  const tick = () =>
    runRetention(db, log).catch((e) => log.error({ err: (e as Error).message }, 'retention failed'));
  void tick();
  const t = setInterval(tick, everyMs);
  t.unref();
  return () => clearInterval(t);
}
