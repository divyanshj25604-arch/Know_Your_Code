import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * Signed, read-only share links for one snapshot (P1.5). Stateless: the token carries its expiry and issue time and
 * is signed with a key derived from COOKIE_SECRET (HKDF, own label, so it can never be confused with a cookie
 * signature). It is bound to one snapshot id. Revocation is per snapshot: `snapshots.shares_revoked_at` invalidates
 * every token issued before it.
 *
 *   kss1.<expires ms base36>.<issued ms base36>.<HMAC-SHA256 base64url>
 */
const PREFIX = 'kss1';
const TOKEN_RE = /^kss1\.([0-9a-z]{1,12})\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{43})$/;
export const MAX_SHARE_TTL_HOURS = 7 * 24;

export class ShareTokens {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync('sha256', secret, 'kyc-share-tokens', 'kyc share token v1', 32));
  }

  private mac(snapshotId: string, expires: number, issued: number): Buffer {
    return createHmac('sha256', this.key).update(`${PREFIX}:${snapshotId}:${expires}:${issued}`).digest();
  }

  issue(snapshotId: string, ttlHours: number, now = Date.now()): { token: string; expiresAt: Date } {
    const hours = Math.min(Math.max(1, Math.floor(ttlHours)), MAX_SHARE_TTL_HOURS);
    const expires = now + hours * 3600_000;
    const sig = this.mac(snapshotId, expires, now).toString('base64url');
    return {
      token: `${PREFIX}.${expires.toString(36)}.${now.toString(36)}.${sig}`,
      expiresAt: new Date(expires),
    };
  }

  /**
   * True only for a well-formed, correctly signed, unexpired token for exactly this snapshot that was issued after
   * the snapshot's last revocation.
   */
  verify(token: string, snapshotId: string, revokedAt: Date | null, now = Date.now()): boolean {
    const m = TOKEN_RE.exec(token);
    if (!m) return false;
    const expires = parseInt(m[1]!, 36);
    const issued = parseInt(m[2]!, 36);
    if (!Number.isSafeInteger(expires) || !Number.isSafeInteger(issued)) return false;
    // Exactly one spelling of a token is valid. The timestamps must be in canonical base 36 (no leading zeros or
    // other spellings of the same number), and the signature is compared as its canonical base64url text, not as
    // decoded bytes: decoding ignores the unused low bits of the last character, so "…A" and "…B" can decode to
    // the same bytes and an altered token would otherwise still verify.
    if (m[1] !== expires.toString(36) || m[2] !== issued.toString(36)) return false;
    const given = Buffer.from(m[3]!, 'utf8');
    const want = Buffer.from(this.mac(snapshotId, expires, issued).toString('base64url'), 'utf8');
    if (given.length !== want.length || !timingSafeEqual(given, want)) return false;
    if (expires <= now || issued > now + 60_000) return false;
    if (revokedAt && issued <= revokedAt.getTime()) return false;
    return true;
  }
}
