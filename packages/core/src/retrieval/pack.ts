/** Line ranges of repository text that was actually sent to the model, per file. */
export type AllowedRanges = Map<string, [number, number][]>;

export const estimateTokens = (s: string): number => Math.ceil(s.length / 3.5);

export function isAllowed(ranges: AllowedRanges, ref: { path: string; line: number }): boolean {
  return (ranges.get(ref.path) ?? []).some(([a, b]) => ref.line >= a && ref.line <= b);
}

/** Merge overlapping or adjacent intervals; result is sorted. */
export function mergeRanges(rs: [number, number][]): [number, number][] {
  const sorted = [...rs].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const MAX_LINE = 300;

/**
 * A token-budgeted context pack: numbered source snippets and short text items. A line of a file is sent at most
 * once (later snippets skip lines already included), and the allowed ranges are kept merged, so citations can be
 * checked exactly against what the model saw.
 */
export class Pack {
  parts: string[] = [];
  ranges: AllowedRanges = new Map();
  items: string[] = [];
  used = 0;
  truncated = false;
  constructor(private readonly max: number) {}

  get remaining() {
    return this.max - this.used;
  }

  private covered(path: string, n: number) {
    return isAllowed(this.ranges, { path, line: n });
  }

  private addRange(path: string, a: number, b: number) {
    this.ranges.set(path, mergeRanges([...(this.ranges.get(path) ?? []), [a, b]]));
  }

  /** Add numbered lines `from..to` (1-based, inclusive) of `path`, skipping lines already in the pack. */
  snippet(name: string, path: string, allLines: string[], from: number, to: number, itemBudget: number, note = '') {
    const a = Math.max(1, from);
    const b = Math.min(allLines.length, to);
    if (b < a) return;
    let budget = Math.min(itemBudget, this.remaining);
    if (budget <= 40) {
      this.truncated = true;
      return;
    }
    // Uncovered segments of [a, b].
    const segments: [number, number][] = [];
    for (let n = a; n <= b; n++) {
      if (this.covered(path, n)) continue;
      const last = segments[segments.length - 1];
      if (last && last[1] === n - 1) last[1] = n;
      else segments.push([n, n]);
    }
    if (segments.length === 0) return; // everything already in the pack
    let added = false;
    for (const [sa, sb] of segments) {
      // A remainder that is only blank lines (e.g. a file's trailing newline) carries nothing worth a token.
      if (allLines.slice(sa - 1, sb).every((l) => l.trim() === '')) continue;
      const out: string[] = [];
      let tokens = 20;
      let last = sa - 1;
      for (let n = sa; n <= sb; n++) {
        let line = allLines[n - 1] ?? '';
        if (line.length > MAX_LINE) line = `${line.slice(0, MAX_LINE)} …`;
        const row = `${n}| ${line}`;
        const t = estimateTokens(row) + 1;
        if (tokens + t > budget) {
          this.truncated = true;
          break;
        }
        tokens += t;
        out.push(row);
        last = n;
      }
      if (out.length === 0) break;
      this.parts.push(`[${name}] file: ${path} lines ${sa}-${last}${note ? ` (${note})` : ''}\n${out.join('\n')}`);
      this.used += tokens;
      budget -= tokens;
      this.addRange(path, sa, last);
      added = true;
      if (last < sb || budget <= 40) break;
    }
    if (added) this.items.push(name);
  }

  text(name: string, body: string, itemBudget: number) {
    const budget = Math.min(itemBudget, this.remaining);
    if (budget <= 20) {
      this.truncated = true;
      return;
    }
    const OVERHEAD = 5; // the "[NAME]" header
    let b = body;
    if (estimateTokens(b) + OVERHEAD > budget) {
      const suffix = '\n…(truncated)';
      const chars = Math.max(0, Math.floor((budget - OVERHEAD - estimateTokens(suffix) - 1) * 3.5));
      b = `${b.slice(0, chars)}${suffix}`;
      this.truncated = true;
    }
    this.parts.push(`[${name}]\n${b}`);
    // Never more than the item's budget, so the pack as a whole never exceeds its maximum.
    this.used += Math.min(budget, estimateTokens(b) + OVERHEAD);
    this.items.push(name);
  }
}
