import type { Db } from '../db/pool';

/**
 * Database connectivity (P4.2). Connection failures are told apart from query bugs, so users get a retryable
 * "temporarily unavailable" (503) and operators a clear log line, never a stack trace or a connection string.
 */
const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
]);

export function isDbConnectionError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  if (err.code && CONNECTION_CODES.has(err.code)) return true;
  // SQLSTATE class 08 (connection exception), 57P01-57P03 (admin shutdown, crash shutdown, cannot connect now).
  if (err.code && (/^08/.test(err.code) || /^57P0[123]$/.test(err.code))) return true;
  return /Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error/i.test(
    err.message ?? '',
  );
}

/** Describe a connection failure without hosts, users or passwords. */
export function describeDbError(e: unknown): string {
  const err = e as { code?: string } | null;
  return err?.code ? `database unreachable (${err.code})` : 'database unreachable';
}

/**
 * Wait for the database at start-up (it may still be starting after a platform restart): retry with backoff, then
 * give up with a clear message. Returns null on success, or the reason it gave up.
 */
export async function waitForDatabase(
  db: Db,
  opts: { attempts?: number; delayMs?: number; onRetry?: (attempt: number, reason: string) => void } = {},
): Promise<string | null> {
  const attempts = opts.attempts ?? 10;
  let delay = opts.delayMs ?? 1000;
  for (let i = 1; ; i++) {
    try {
      await db.query('SELECT 1');
      return null;
    } catch (e) {
      const reason = isDbConnectionError(e) ? describeDbError(e) : 'database rejected the connection';
      if (i >= attempts) return reason;
      opts.onRetry?.(i, reason);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 10_000);
    }
  }
}
