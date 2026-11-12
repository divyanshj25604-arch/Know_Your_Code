import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/pool';

/** Advisory-lock key shared by every instance of this application on one database. */
export const INSTANCE_LOCK_KEY = 'kyc:job-runner';

/**
 * Single-instance guard (P4.2). The in-process job runner, interrupted-import recovery and retention must run in
 * exactly one process per database: two would re-run each other's imports. The process that holds a session-level
 * Postgres advisory lock is the worker; any other instance serves HTTP and keeps new imports queued until it gets
 * the lock.
 *
 * This fits zero-downtime deploys: the new instance starts in standby, passes health checks, and takes over the
 * moment the old instance exits and its connection (and lock) closes. If the lock connection breaks, this process can
 * no longer prove it is the only worker, so it reports it and exits for the platform to restart it.
 */
export class InstanceLock {
  private client: pg.PoolClient | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastWaitLog = 0;
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    private readonly opts: { pollMs?: number; onLost?: () => void } = {},
  ) {}

  get held(): boolean {
    return this.client !== null;
  }

  /** Try once. Resolves true when this process now holds the lock. */
  async tryAcquire(): Promise<boolean> {
    if (this.client) return true;
    const c = await this.db.connect();
    try {
      const r = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [
        INSTANCE_LOCK_KEY,
      ]);
      if (!r.rows[0]?.ok) {
        c.release();
        return false;
      }
    } catch (e) {
      c.release();
      throw e;
    }
    c.on('error', (e) => {
      if (this.stopped) return;
      this.log.error(
        { event: 'instance_lock_lost', err: e.message },
        'lost the database connection holding the worker lock',
      );
      this.client = null;
      (this.opts.onLost ?? (() => process.exit(1)))();
    });
    this.client = c;
    return true;
  }

  /** Poll until the lock is held, then call `onAcquired` once. */
  start(onAcquired: () => void | Promise<void>) {
    const poll = async () => {
      if (this.stopped) return;
      try {
        if (await this.tryAcquire()) {
          this.log.info({ event: 'instance_lock_acquired' }, 'this instance now runs background jobs');
          await onAcquired();
          return;
        }
        if (Date.now() - this.lastWaitLog > 60_000) {
          this.lastWaitLog = Date.now();
          this.log.warn(
            { event: 'instance_standby' },
            'another instance holds the worker lock; imports stay queued here until it stops',
          );
        }
      } catch (e) {
        this.log.warn(
          { event: 'instance_lock_error', err: (e as Error).message },
          'could not check the worker lock',
        );
      }
      this.timer = setTimeout(() => void poll(), this.opts.pollMs ?? 2000);
      this.timer.unref();
    };
    void poll();
  }

  /** Release the lock (shutdown). */
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    const c = this.client;
    this.client = null;
    if (!c) return;
    try {
      await c.query('SELECT pg_advisory_unlock(hashtext($1))', [INSTANCE_LOCK_KEY]);
    } catch {
      // The connection is going away anyway; the lock goes with it.
    }
    c.release();
  }
}
