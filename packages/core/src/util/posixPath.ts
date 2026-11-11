/**
 * The two POSIX path operations the analyser needs, ported from Node's `path.posix` so core has no Node dependency.
 * Behaviour matches `path.posix.dirname` and `path.posix.normalize(path.posix.join(...))` exactly; that equivalence
 * is checked against Node in tests/posixPath.test.ts.
 */

export function dirname(p: string): string {
  if (p.length === 0) return '.';
  const hasRoot = p[0] === '/';
  let end = -1;
  let matchedSlash = true;
  for (let i = p.length - 1; i >= 1; i--) {
    if (p[i] === '/') {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? '/' : '.';
  if (hasRoot && end === 1) return '//';
  return p.slice(0, end);
}

export function normalize(p: string): string {
  if (p.length === 0) return '.';
  const isAbsolute = p[0] === '/';
  const trailingSeparator = p[p.length - 1] === '/';
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!isAbsolute) out.push('..');
    } else {
      out.push(seg);
    }
  }
  let joined = out.join('/');
  if (joined.length === 0 && !isAbsolute) joined = '.';
  if (joined.length > 0 && trailingSeparator) joined += '/';
  return isAbsolute ? `/${joined}` : joined;
}

export function join(...parts: string[]): string {
  const joined = parts.filter((s) => s.length > 0).join('/');
  return joined.length === 0 ? '.' : normalize(joined);
}
