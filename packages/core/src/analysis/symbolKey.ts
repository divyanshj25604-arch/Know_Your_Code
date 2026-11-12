import type { SymbolRow } from './types';

/**
 * Stable symbol keys (P1.3). A key names a declaration by *where it sits in the code's structure*, never by a
 * database id, a line number or the order the analyser happened to visit it, so re-importing unchanged code yields
 * identical keys, and editing one function does not re-key the others.
 *
 *   key      = <file> '#' <segment> ('/' <segment>)*
 *   file     = the repository-relative POSIX path, escaped
 *   segment  = <kind> ':' <name> ['~' <ordinal>]   one per enclosing symbol, outermost first
 *   ordinal  = 2, 3, … only when siblings share kind and name (overload signatures, repeated callbacks,
 *              same-named locals in different blocks), numbered by source position
 *
 *   src/auth/login.ts#function:login/parameter:email
 *   src/routes/auth.js#function:POST %2Flogin
 *   src/a.ts#function:parse~2                       (the second `parse` overload signature)
 *
 * Known limitations (documented in project-docs/00 and the Phase 1 report):
 *  - Renaming or moving a file, or renaming a symbol or any of its parents, changes the key (no rename tracking).
 *  - Changing a symbol's kind (e.g. `const f = () => …` to `function f`) changes the key.
 *  - Inserting a same-named sibling *before* an existing one shifts the later ordinals.
 *  - Anonymous callbacks are named from their call site (`router.get callback`), so editing the callee text re-keys
 *    them.
 * Bump SYMBOL_KEY_VERSION whenever this scheme or the analyser's naming changes; each analysis run records it.
 */
export const SYMBOL_KEY_VERSION = 1;

/** Percent-encode `special` characters and control characters (code < 0x20), so separators stay unambiguous. */
function escape(s: string, special: string): string {
  let out = '';
  for (const c of s) {
    const code = c.charCodeAt(0);
    out += code < 0x20 || special.includes(c) ? `%${code.toString(16).toUpperCase().padStart(2, '0')}` : c;
  }
  return out;
}
const escPath = (s: string) => escape(s, '%#');
const escName = (s: string) => escape(s, '%/#~:');

const byPosition = (a: SymbolRow, b: SymbolRow) =>
  a.startLine - b.startLine || a.startCol - b.startCol || a.endLine - b.endLine || a.endCol - b.endCol;

/**
 * Compute the stable key of every symbol. `parentKey` links are followed on the input keys, so this works on any
 * unique per-run keys. Returns input key -> stable key; the stable keys are unique within the input.
 */
export function stableSymbolKeys(symbols: readonly SymbolRow[]): Map<string, string> {
  const byKey = new Map(symbols.map((s) => [s.key, s]));
  // Ordinals: siblings with the same parent, kind and name, ordered by source position (ties keep input order).
  const groups = new Map<string, SymbolRow[]>();
  for (const s of symbols) {
    const scope = s.parentKey ?? `file:${s.path}`;
    const g = `${scope}\u0000${s.kind}\u0000${s.name}`;
    const list = groups.get(g);
    if (list) list.push(s);
    else groups.set(g, [s]);
  }
  const ordinal = new Map<string, number>();
  for (const list of groups.values()) {
    [...list].sort(byPosition).forEach((s, i) => ordinal.set(s.key, i + 1));
  }

  const out = new Map<string, string>();
  const resolve = (s: SymbolRow, depth: number): string => {
    const done = out.get(s.key);
    if (done !== undefined) return done;
    if (depth > 10_000) throw new Error(`symbol parent chain does not terminate at ${s.key}`);
    const n = ordinal.get(s.key) ?? 1;
    const segment = `${s.kind}:${escName(s.name)}${n > 1 ? `~${n}` : ''}`;
    const parent = s.parentKey ? byKey.get(s.parentKey) : undefined;
    const key = parent ? `${resolve(parent, depth + 1)}/${segment}` : `${escPath(s.path)}#${segment}`;
    out.set(s.key, key);
    return key;
  };
  for (const s of symbols) resolve(s, 0);
  return out;
}

/** Replace each symbol's run-local key (and its parent link) with its stable key, in place. */
export function applyStableKeys(symbols: SymbolRow[]): void {
  const keys = stableSymbolKeys(symbols);
  for (const s of symbols) {
    s.key = keys.get(s.key)!;
    s.parentKey = s.parentKey ? (keys.get(s.parentKey) ?? null) : null;
  }
}
