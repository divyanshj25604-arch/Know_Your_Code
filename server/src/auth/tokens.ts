import { createHash, randomBytes } from 'node:crypto';

/** Recognisable prefix: makes leaked tokens easy to find with secret scanners and in support tickets. */
const PREFIX = 'kyc_st_';
const TOKEN_RE = /^kyc_st_[A-Za-z0-9_-]{43}$/;

/** A new opaque session token: 256 random bits. Only its hash is ever stored. */
export function newSessionToken(): string {
  return PREFIX + randomBytes(32).toString('base64url');
}

/** Cheap shape check before any database lookup. */
export function isWellFormedToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
