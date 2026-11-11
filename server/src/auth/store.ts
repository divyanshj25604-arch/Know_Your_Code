import type { AccountView, TokenTransport } from '@kyc/contracts';
import type { Db, Queryable } from '../db/pool';
import { hashToken, newSessionToken } from './tokens';

export interface UserRow {
  id: string;
  kind: 'anonymous' | 'registered';
  email: string | null;
}

export const toAccountView = (u: UserRow): AccountView => ({ id: u.id, kind: u.kind, email: u.email });

/** Postgres unique-violation code. */
const UNIQUE_VIOLATION = '23505';
export const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === UNIQUE_VIOLATION;

export async function createAnonymousUser(q: Queryable): Promise<string> {
  const r = await q.query<{ id: string }>(`INSERT INTO users (kind) VALUES ('anonymous') RETURNING id`);
  return r.rows[0]!.id;
}

/**
 * Mark an anonymous user as seen. Returns false when the id is unknown or is no longer anonymous: an anonymous
 * cookie must never authenticate a registered account (an account upgraded in place keeps the old id).
 */
export async function touchAnonymousUser(q: Queryable, id: string): Promise<boolean> {
  const r = await q.query(`UPDATE users SET last_seen_at = now() WHERE id=$1 AND kind='anonymous'`, [id]);
  return (r.rowCount ?? 0) > 0;
}

export async function getUser(q: Queryable, id: string): Promise<UserRow | null> {
  const r = await q.query<UserRow>('SELECT id, kind, email FROM users WHERE id=$1', [id]);
  return r.rows[0] ?? null;
}

export async function findCredentials(
  q: Queryable,
  email: string,
): Promise<(UserRow & { passwordHash: string }) | null> {
  const r = await q.query<UserRow & { password_hash: string }>(
    `SELECT id, kind, email, password_hash FROM users WHERE email=$1 AND kind='registered'`,
    [email],
  );
  const u = r.rows[0];
  return u ? { id: u.id, kind: u.kind, email: u.email, passwordHash: u.password_hash } : null;
}

export async function createRegisteredUser(
  q: Queryable,
  email: string,
  passwordHash: string,
): Promise<UserRow> {
  const r = await q.query<UserRow>(
    `INSERT INTO users (kind, email, password_hash, registered_at) VALUES ('registered', $1, $2, now())
     RETURNING id, kind, email`,
    [email, passwordHash],
  );
  return r.rows[0]!;
}

/**
 * Upgrade an anonymous user to a registered one in place. The id is unchanged, so everything the anonymous user
 * created (repositories, explanations, feedback, events) belongs to the account with no data movement.
 * Returns null when the user is not (or no longer) anonymous.
 */
export async function upgradeAnonymousUser(
  q: Queryable,
  id: string,
  email: string,
  passwordHash: string,
): Promise<UserRow | null> {
  const r = await q.query<UserRow>(
    `UPDATE users SET kind='registered', email=$2, password_hash=$3, registered_at=now(), last_seen_at=now()
     WHERE id=$1 AND kind='anonymous' RETURNING id, kind, email`,
    [id, email, passwordHash],
  );
  return r.rows[0] ?? null;
}

// ---------------------------------------------------------------- sessions

export interface SessionRow {
  id: string;
  userId: string;
  transport: TokenTransport;
  expiresAt: Date;
}

export async function createSession(
  q: Queryable,
  userId: string,
  transport: TokenTransport,
  ttlDays: number,
): Promise<{ token: string; session: SessionRow }> {
  const token = newSessionToken();
  const r = await q.query<{ id: string; expires_at: Date }>(
    `INSERT INTO user_sessions (user_id, token_hash, transport, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4)) RETURNING id, expires_at`,
    [userId, hashToken(token), transport, ttlDays],
  );
  const row = r.rows[0]!;
  return { token, session: { id: row.id, userId, transport, expiresAt: row.expires_at } };
}

export type SessionLookup =
  { ok: true; session: SessionRow; user: UserRow } | { ok: false; reason: 'unknown' | 'expired' | 'revoked' };

/** Resolve a presented token. Expired and revoked sessions are distinguished for logging only, never for clients. */
export async function lookupSession(q: Queryable, token: string): Promise<SessionLookup> {
  const r = await q.query<{
    id: string;
    user_id: string;
    transport: TokenTransport;
    expires_at: Date;
    revoked_at: Date | null;
    expired: boolean;
    kind: UserRow['kind'];
    email: string | null;
  }>(
    `SELECT s.id, s.user_id, s.transport, s.expires_at, s.revoked_at, s.expires_at <= now() AS expired,
            u.kind, u.email
     FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [hashToken(token)],
  );
  const s = r.rows[0];
  if (!s || s.kind !== 'registered') return { ok: false, reason: 'unknown' };
  if (s.revoked_at) return { ok: false, reason: 'revoked' };
  if (s.expired) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    session: { id: s.id, userId: s.user_id, transport: s.transport, expiresAt: s.expires_at },
    user: { id: s.user_id, kind: s.kind, email: s.email },
  };
}

/** Record activity at most once every five minutes per session, so authenticated reads do not all write. */
export async function touchSession(q: Queryable, sessionId: string): Promise<void> {
  await q.query(
    `WITH s AS (
       UPDATE user_sessions SET last_used_at = now()
       WHERE id=$1 AND last_used_at < now() - interval '5 minutes' RETURNING user_id)
     UPDATE users SET last_seen_at = now() WHERE id IN (SELECT user_id FROM s)`,
    [sessionId],
  );
}

export async function revokeSession(q: Queryable, sessionId: string): Promise<void> {
  await q.query('UPDATE user_sessions SET revoked_at = now() WHERE id=$1 AND revoked_at IS NULL', [
    sessionId,
  ]);
}

export async function revokeAllSessions(q: Queryable, userId: string): Promise<number> {
  const r = await q.query(
    'UPDATE user_sessions SET revoked_at = now() WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now()',
    [userId],
  );
  return r.rowCount ?? 0;
}

/** Retention: forget sessions that ended (expired or revoked) more than 30 days ago. */
export async function deleteEndedSessions(db: Db): Promise<number> {
  const r = await db.query(
    `DELETE FROM user_sessions
     WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days'`,
  );
  return r.rowCount ?? 0;
}
