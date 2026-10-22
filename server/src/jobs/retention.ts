import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/pool';
import { deleteExpired } from '../index/snapshots';

/** Delete expired snapshots (7-day retention, docs/10) and trim operational tables that must not keep data forever. */
export async function runRetention(db: Db, log: FastifyBaseLogger): Promise<{ snapshots: number }> {
  const snapshots = await deleteExpired(db);
  // Cost and event rows carry no code, but are kept 90 days only.
  await db.query(`DELETE FROM llm_calls WHERE created_at < now() - interval '90 days'`);
  await db.query(`DELETE FROM events WHERE created_at < now() - interval '90 days'`);
  await db.query(`DELETE FROM deletion_log WHERE deleted_at < now() - interval '90 days'`);
  // Owners with nothing left and no recent activity.
  await db.query(
    `DELETE FROM owners o WHERE o.last_seen_at < now() - interval '30 days'
       AND NOT EXISTS (SELECT 1 FROM repositories r WHERE r.owner_id = o.id)`,
  );
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
