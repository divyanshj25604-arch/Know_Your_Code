import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt (Node built-in; memory-hard). Stored format, self-describing so parameters can be
 * raised later without breaking existing hashes:  scrypt$<log2 N>$<r>$<p>$<salt b64url>$<hash b64url>
 */
const LOG_N = 15; // N = 32768, ~32 MiB per hash
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
// scrypt needs 128 * N * r bytes; allow headroom over Node's 32 MiB default.
const MAX_MEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, keyLen, opts, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(password, salt, KEY_LEN, { N: 2 ** LOG_N, r: R, p: P, maxmem: MAX_MEM });
  return ['scrypt', LOG_N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** Constant-time comparison. A malformed stored hash verifies as false rather than throwing. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, logN, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const n = Number(logN);
  const rr = Number(r);
  const pp = Number(p);
  if (![n, rr, pp].every((x) => Number.isInteger(x) && x > 0) || n > 20) return false;
  const expected = Buffer.from(keyB64, 'base64url');
  if (expected.length === 0) return false;
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64url'), expected.length, {
    N: 2 ** n,
    r: rr,
    p: pp,
    maxmem: MAX_MEM,
  });
  return timingSafeEqual(actual, expected);
}

/**
 * A valid hash of a random password, computed once. Sign-in for an unknown email verifies against it so the response
 * takes as long as for a known email, and timing does not reveal which emails have accounts.
 */
let decoy: Promise<string> | null = null;
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(24).toString('base64url'));
  return decoy;
}
