import { AppError } from '../http/errors';

export interface RepoRef {
  owner: string;
  name: string;
  /** Branch, tag, or commit named in a /tree/<ref> URL; undefined means "default branch". */
  ref?: string;
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9._\-/]{1,200}$/;

export function isSafeRef(ref: string): boolean {
  return (
    REF_RE.test(ref) &&
    !ref.includes('..') &&
    !ref.startsWith('/') &&
    !ref.endsWith('/') &&
    !ref.includes('//') &&
    !ref.startsWith('-')
  );
}

function hasWhitespaceOrControl(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x20 || c === 0x7f || /\s/.test(ch)) return true;
  }
  return false;
}

/**
 * Parse a user-supplied repository URL. Only https/http URLs on github.com (or www.github.com) with the
 * shape github.com/{owner}/{repo}[/tree/{ref}] are accepted (docs/08 §1). Anything else is rejected before
 * any network request is made, which is the primary SSRF control.
 */
export function parseRepoUrl(input: string, refOverride?: string): RepoRef {
  const bad = () => new AppError('INVALID_URL');
  const raw = input.trim();
  if (raw.length === 0 || raw.length > 300 || hasWhitespaceOrControl(raw)) throw bad();

  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw bad();
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw bad();
  if (u.username || u.password || u.port) throw bad();
  const host = u.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') throw bad();
  if (u.search || u.hash) {
    // Allow a bare "?tab=readme..." style suffix? No: keep the grammar strict and predictable.
    throw bad();
  }

  let segs: string[];
  try {
    segs = u.pathname
      .split('/')
      .filter((s, i, a) => !(s === '' && (i === 0 || i === a.length - 1)))
      .map(decodeURIComponent);
  } catch {
    throw bad();
  }
  if (segs.length < 2) throw bad();
  const [owner, rawName, ...rest] = segs as [string, string, ...string[]];
  const name = rawName.endsWith('.git') ? rawName.slice(0, -4) : rawName;
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name) || name === '.' || name === '..') throw bad();

  let ref: string | undefined;
  if (rest.length > 0) {
    if (rest[0] !== 'tree' || rest.length < 2) throw bad();
    ref = rest.slice(1).join('/');
  }
  if (refOverride) ref = refOverride;
  if (ref !== undefined && !isSafeRef(ref)) throw bad();
  return { owner, name, ...(ref ? { ref } : {}) };
}
