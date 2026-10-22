import type { Db } from '../db/pool';
import type { FastifyBaseLogger } from 'fastify';
import { runImport, type ImportDeps } from './importJob';

/**
 * In-process job queue with durable state in Postgres (docs/07 ADR-06). `queued`/`running` jobs are re-queued
 * on boot, so a crash never strands a snapshot.
 */
export class JobRunner {
  private queue: string[] = [];
  private running = 0;
  private stopped = false;
  private idleResolvers: (() => void)[] = [];

  constructor(
    private readonly deps: () => ImportDeps,
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    private readonly concurrency: number,
  ) {}

  get depth(): number {
    return this.queue.length + this.running;
  }

  enqueue(snapshotId: string) {
    if (this.stopped || this.queue.includes(snapshotId)) return;
    this.queue.push(snapshotId);
    this.pump();
  }

  async recover(): Promise<number> {
    const r = await this.db.query<{ snapshot_id: string }>(
      `UPDATE jobs SET state='queued', attempts = attempts + 1, updated_at=now()
       WHERE state IN ('queued','running') AND attempts < 3 RETURNING snapshot_id`,
    );
    await this.db.query(
      `UPDATE jobs SET state='failed' WHERE state IN ('queued','running') AND attempts >= 3`,
    );
    await this.db.query(
      `UPDATE snapshots SET status='failed', error_code='INDEX_FAILED', error_message='Analysis was interrupted.'
       WHERE status IN ('queued','fetching','filtering','analysing','summarising') AND id NOT IN (SELECT snapshot_id FROM jobs WHERE state='queued')`,
    );
    for (const row of r.rows) this.enqueue(row.snapshot_id);
    return r.rows.length;
  }

  private pump() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift()!;
      this.running++;
      void this.db
        .query(`UPDATE jobs SET state='running', updated_at=now() WHERE snapshot_id=$1`, [id])
        .then(() => runImport(this.deps(), id))
        .catch((e) => this.log.error({ err: (e as Error).message }, 'job crashed'))
        .finally(() => {
          this.running--;
          if (this.depth === 0) this.idleResolvers.splice(0).forEach((r) => r());
          this.pump();
        });
    }
  }

  /** Resolves when no work is queued or running (used by tests and graceful shutdown). */
  idle(): Promise<void> {
    return this.depth === 0 ? Promise.resolve() : new Promise((r) => this.idleResolvers.push(r));
  }

  async stop() {
    this.stopped = true;
    await this.idle();
  }
}
