import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  LoginRequestSchema,
  LogoutRequestSchema,
  RegisterRequestSchema,
  type AuthSessionResponse,
  type ClaimResponse,
  type MeResponse,
  type TokenTransport,
} from '@kyc/contracts';
import { KycError } from '@kyc/core';
import { claimAnonymousData, claimableRepositories } from '../auth/claim';
import { decoyHash, hashPassword, verifyPassword } from '../auth/password';
import {
  createRegisteredUser,
  createSession,
  findCredentials,
  getUser,
  isUniqueViolation,
  revokeAllSessions,
  revokeSession,
  toAccountView,
  upgradeAnonymousUser,
  type UserRow,
} from '../auth/store';
import type { Services } from '../services';
import { parse } from './validate';

const HOUR = 3600_000;

/**
 * Accounts: register, sign in, sign out, who-am-I, and claiming this browser's anonymous work. Credentials are only
 * ever accepted in a JSON body over the same cross-site protections as every other state-changing route.
 */
export function registerAuthRoutes(app: FastifyInstance, svc: Services) {
  const { db, config, limiter, identity } = svc;

  /** Deliver a new session: an httpOnly cookie for the web, or the token in the body (once) for bearer clients. */
  async function startSession(
    reply: FastifyReply,
    user: UserRow,
    transport: TokenTransport,
    claimable: AuthSessionResponse['claimable'],
  ): Promise<AuthSessionResponse> {
    const { token, session } = await createSession(db, user.id, transport, config.SESSION_TTL_DAYS);
    const base = { user: toAccountView(user), expiresAt: session.expiresAt.toISOString(), claimable };
    if (transport === 'cookie') {
      identity.setSessionCookie(reply, token, session.expiresAt);
      return base;
    }
    return { ...base, token };
  }

  app.post('/api/v1/auth/register', async (req, reply): Promise<AuthSessionResponse> => {
    limiter.check('auth:ip', req.ip, config.RATE_AUTH_PER_HOUR, HOUR);
    const body = parse(RegisterRequestSchema, req.body);
    if (body.transport === 'cookie' && req.kycCrossOrigin)
      throw new KycError('INVALID_REQUEST', 'Use transport "bearer" from this application.');
    const current = await identity.peek(req, reply);
    if (current?.kind === 'registered')
      throw new KycError(
        'INVALID_REQUEST',
        "You're already signed in. Sign out first to create another account.",
      );
    const hash = await hashPassword(body.password);
    let user: UserRow;
    try {
      // The browser's anonymous work becomes the account's work: same user id, nothing to move.
      const upgraded =
        current?.kind === 'anonymous'
          ? await upgradeAnonymousUser(db, current.userId, body.email, hash)
          : null;
      user = upgraded ?? (await createRegisteredUser(db, body.email, hash));
    } catch (e) {
      if (isUniqueViolation(e)) throw new KycError('EMAIL_TAKEN');
      throw e;
    }
    if (current?.kind === 'anonymous') identity.clearAnonymousCookie(reply);
    req.log.info({ userId: user.id, upgraded: current?.kind === 'anonymous' }, 'account registered');
    reply.status(201);
    return startSession(reply, user, body.transport, null);
  });

  app.post('/api/v1/auth/login', async (req, reply): Promise<AuthSessionResponse> => {
    limiter.check('auth:ip', req.ip, config.RATE_AUTH_PER_HOUR, HOUR);
    const body = parse(LoginRequestSchema, req.body);
    limiter.check('auth:email', body.email, 10, HOUR);
    if (body.transport === 'cookie' && req.kycCrossOrigin)
      throw new KycError('INVALID_REQUEST', 'Use transport "bearer" from this application.');
    const found = await findCredentials(db, body.email);
    // Verify against a decoy for unknown emails so response time does not reveal which emails have accounts.
    const ok = await verifyPassword(body.password, found?.passwordHash ?? (await decoyHash()));
    if (!found || !ok) {
      req.log.info('sign-in failed');
      throw new KycError('INVALID_CREDENTIALS');
    }
    const anon = body.transport === 'cookie' ? await identity.anonymousFromCookie(req) : null;
    const claimable = anon ? await claimableRepositories(db, anon) : 0;
    req.log.info({ userId: found.id, transport: body.transport }, 'signed in');
    return startSession(reply, found, body.transport, claimable > 0 ? { repositories: claimable } : null);
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const { all } = parse(LogoutRequestSchema, req.body ?? {});
    const who = await identity.peek(req, reply);
    if (who?.sessionId) {
      if (all) await revokeAllSessions(db, who.userId);
      else await revokeSession(db, who.sessionId);
    }
    identity.clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get('/api/v1/auth/me', async (req, reply): Promise<MeResponse> => {
    const who = await identity.peek(req, reply);
    if (!who) return { user: null };
    const user = await getUser(db, who.userId);
    return { user: user ? toAccountView(user) : null };
  });

  /**
   * Add this browser's anonymous work to the signed-in account. Requires both proofs at once: the account's web
   * session and the anonymous user's signed cookie. Nobody can claim anonymous work they do not hold the cookie for.
   */
  app.post('/api/v1/auth/claim', async (req, reply): Promise<ClaimResponse> => {
    const who = await identity.peek(req, reply);
    if (!who || who.kind !== 'registered') throw new KycError('AUTH_REQUIRED');
    if (who.via !== 'session_cookie')
      throw new KycError('INVALID_REQUEST', 'Claiming anonymous work is only possible from the web browser.');
    const anon = await identity.anonymousFromCookie(req);
    if (!anon) throw new KycError('NOT_FOUND', 'There is no anonymous work in this browser to add.');
    const claimed = await claimAnonymousData(db, anon, who.userId);
    if (!claimed) throw new KycError('NOT_FOUND', 'There is no anonymous work in this browser to add.');
    identity.clearAnonymousCookie(reply);
    req.log.info({ userId: who.userId, ...claimed }, 'anonymous work claimed');
    return { claimed };
  });
}
