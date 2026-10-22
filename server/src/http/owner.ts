import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config/env';
import type { Db } from '../db/pool';
import { ensureOwner } from '../index/snapshots';

const COOKIE = 'kyc_owner';
const UUID = /^[0-9a-f-]{36}$/i;

/** Resolve the anonymous owner from the signed cookie, creating one (and setting the cookie) when absent/invalid. */
export async function getOwner(
  db: Db,
  config: Config,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<string> {
  const raw = req.cookies[COOKIE];
  let id: string | null = null;
  if (raw) {
    const un = req.unsignCookie(raw);
    if (un.valid && un.value && UUID.test(un.value)) id = un.value;
  }
  const ownerId = await ensureOwner(db, id);
  if (ownerId !== id) {
    reply.setCookie(COOKIE, ownerId, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * 24 * 3600,
    });
  }
  return ownerId;
}
