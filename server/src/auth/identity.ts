import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import { KycError } from '@kyc/core';
import type { Config } from '../config/env';
import type { Db } from '../db/pool';
import { isWellFormedToken } from './tokens';
import { createAnonymousUser, lookupSession, touchAnonymousUser, touchSession } from './store';

/** Signed cookie holding an anonymous user's id (unchanged name, so existing browsers keep their work). */
export const ANON_COOKIE = 'kyc_owner';
/** httpOnly cookie holding a web session token. Never readable by page scripts. */
export const SESSION_COOKIE = 'kyc_session';
const ANON_MAX_AGE_S = 30 * 24 * 3600;
const UUID = /^[0-9a-f-]{36}$/i;

export interface Identity {
  userId: string;
  kind: 'anonymous' | 'registered';
  via: 'anonymous_cookie' | 'session_cookie' | 'bearer';
  sessionId: string | null;
  email: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * True when the request comes from an allow-listed foreign origin (a desktop shell, P1.6). Such requests are
     * authenticated by bearer token only; cookies are ignored and no anonymous identity is ever minted for them.
     */
    kycCrossOrigin: boolean;
  }
}

/**
 * Resolves who is calling, in this order:
 *  1. `Authorization: Bearer <token>` — a bearer session. If the header is present it must be valid: a bad, expired
 *     or revoked token is a 401, never a silent downgrade to anonymous.
 *  2. Requests from an allow-listed foreign origin carry no usable cookies: without a bearer token they are 401.
 *  3. The `kyc_session` cookie — a web session. A stale one is cleared and resolution continues.
 *  4. The signed `kyc_owner` cookie — an anonymous user, which is created on first use when the route acts on the
 *     caller's data.
 */
export class IdentityService {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** The caller, creating an anonymous user (and its cookie) when no identity is presented. */
  async require(req: FastifyRequest, reply: FastifyReply): Promise<Identity> {
    const id = await this.resolve(req, reply);
    if (id) return id;
    if (req.kycCrossOrigin) throw new KycError('AUTH_REQUIRED');
    const userId = await createAnonymousUser(this.db);
    reply.setCookie(ANON_COOKIE, userId, { ...this.cookieBase(), signed: true, maxAge: ANON_MAX_AGE_S });
    return { userId, kind: 'anonymous', via: 'anonymous_cookie', sessionId: null, email: null };
  }

  /** The caller if they presented an identity; never creates one. */
  peek(req: FastifyRequest, reply: FastifyReply): Promise<Identity | null> {
    return this.resolve(req, reply);
  }

  /** The anonymous user named by this browser's signed cookie, if it still exists and is still anonymous. */
  async anonymousFromCookie(req: FastifyRequest): Promise<string | null> {
    if (req.kycCrossOrigin) return null;
    const raw = req.cookies[ANON_COOKIE];
    if (!raw) return null;
    const un = req.unsignCookie(raw);
    if (!un.valid || !un.value || !UUID.test(un.value)) return null;
    return (await touchAnonymousUser(this.db, un.value)) ? un.value : null;
  }

  setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
    const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    reply.setCookie(SESSION_COOKIE, token, { ...this.cookieBase(), maxAge });
  }

  clearSessionCookie(reply: FastifyReply) {
    reply.clearCookie(SESSION_COOKIE, this.cookieBase());
  }

  clearAnonymousCookie(reply: FastifyReply) {
    reply.clearCookie(ANON_COOKIE, this.cookieBase());
  }

  private cookieBase() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.COOKIE_SECURE ?? this.config.NODE_ENV === 'production',
      path: '/',
    };
  }

  private async resolve(req: FastifyRequest, reply: FastifyReply): Promise<Identity | null> {
    const auth = req.headers.authorization;
    if (auth !== undefined) return this.fromBearer(auth);
    if (req.kycCrossOrigin) return null;

    const sessionToken = req.cookies[SESSION_COOKIE];
    if (sessionToken !== undefined) {
      const fromCookie = await this.fromSessionCookie(sessionToken);
      if (fromCookie) return fromCookie;
      this.clearSessionCookie(reply); // expired, revoked or forged: the browser stops sending it
    }
    const anonId = await this.anonymousFromCookie(req);
    return anonId
      ? { userId: anonId, kind: 'anonymous', via: 'anonymous_cookie', sessionId: null, email: null }
      : null;
  }

  private async fromBearer(header: string): Promise<Identity> {
    const m = /^Bearer (\S+)$/.exec(header);
    const token = m?.[1];
    if (!token || !isWellFormedToken(token)) throw new KycError('AUTH_REQUIRED');
    const r = await lookupSession(this.db, token);
    // A cookie session's token is never exposed to scripts; presented as a bearer token it was exfiltrated.
    if (!r.ok || r.session.transport !== 'bearer') {
      this.log.info({ reason: r.ok ? 'transport_mismatch' : r.reason }, 'bearer token rejected');
      throw new KycError('AUTH_REQUIRED');
    }
    await touchSession(this.db, r.session.id);
    return {
      userId: r.user.id,
      kind: 'registered',
      via: 'bearer',
      sessionId: r.session.id,
      email: r.user.email,
    };
  }

  private async fromSessionCookie(token: string): Promise<Identity | null> {
    if (!isWellFormedToken(token)) return null;
    const r = await lookupSession(this.db, token);
    if (!r.ok || r.session.transport !== 'cookie') {
      this.log.info({ reason: r.ok ? 'transport_mismatch' : r.reason }, 'session cookie rejected');
      return null;
    }
    await touchSession(this.db, r.session.id);
    return {
      userId: r.user.id,
      kind: 'registered',
      via: 'session_cookie',
      sessionId: r.session.id,
      email: r.user.email,
    };
  }
}
