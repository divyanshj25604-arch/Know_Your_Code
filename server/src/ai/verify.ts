import type { Ref } from '@kyc/contracts';

/** Line ranges of repository text that was actually sent to the model, per file. */
export type AllowedRanges = Map<string, [number, number][]>;

export function isAllowed(ranges: AllowedRanges, ref: Ref): boolean {
  const rs = ranges.get(ref.path);
  if (!rs) return false;
  return rs.some(([a, b]) => ref.line >= a && ref.line <= b);
}

export interface VerifyStats {
  total: number;
  stripped: number;
}

/**
 * Keep only references to files and lines that were in the context pack (docs/09 §10). A reference the model
 * invented, or one outside what it was shown, is removed; the surrounding text is kept.
 */
export function verifyRefs(refs: Ref[] | undefined, ranges: AllowedRanges, stats: VerifyStats): Ref[] {
  const out: Ref[] = [];
  const seen = new Set<string>();
  for (const r of refs ?? []) {
    stats.total++;
    if (!isAllowed(ranges, r)) {
      stats.stripped++;
      continue;
    }
    const k = `${r.path}:${r.line}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

export function verifyLines(
  lines: number[] | undefined,
  path: string | null,
  ranges: AllowedRanges,
  stats: VerifyStats,
): number[] {
  if (!lines || lines.length === 0) return [];
  const ok = lines.filter((l) => {
    stats.total++;
    const good = path !== null && isAllowed(ranges, { path, line: l });
    if (!good) stats.stripped++;
    return good;
  });
  return ok;
}
