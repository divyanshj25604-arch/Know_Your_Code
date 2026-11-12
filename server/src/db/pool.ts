import pg from 'pg';

export type Db = pg.Pool;

/** Anything that can run a query: the pool, or a client checked out for a transaction (see `withTx`). */
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // An idle-client error must not crash the process; the next query surfaces the failure.
  pool.on('error', () => undefined);
  return pool;
}

/** Run `fn` inside one transaction: COMMIT on success, ROLLBACK and rethrow on any error. */
export async function withTx<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    // A failed ROLLBACK means the connection is broken: release it as broken so the pool discards it. The original
    // error is the one worth reporting.
    await client.query('ROLLBACK').catch((rollbackErr: unknown) => {
      client.release(rollbackErr instanceof Error ? rollbackErr : true);
      released = true;
    });
    throw e;
  } finally {
    if (!released) client.release();
  }
}
