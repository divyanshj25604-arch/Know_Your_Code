import type { Relations, Selection } from '@kyc/contracts';
import type { Db } from '../db/pool';
import { getFileContent } from '../index/files';
import { getFileImports, getRelations, getSymbol } from '../index/symbols';
import type { ResolvedSelection } from '../index/resolve';
import { redact } from '../privacy/redact';
import type { AllowedRanges } from '../ai/verify';

export const estimateTokens = (s: string): number => Math.ceil(s.length / 3.5);

export interface ContextPack {
  /** Text placed inside <repository_content>. */
  text: string;
  ranges: AllowedRanges;
  tokens: number;
  relations: Relations | null;
  /** Names of the sections that made it in (for observability and tests). */
  items: string[];
  truncated: boolean;
}

interface BuildOpts {
  db: Db;
  snapshotId: string;
  selection: Selection;
  resolved: ResolvedSelection;
  /** Follow-up question: enables lexical search. */
  question?: string;
  maxTokens: number;
  facts?: { frameworks: string[]; languages: Record<string, number> } | null;
}

const MAX_LINE = 300;
const STOP = new Set([
  'what',
  'when',
  'where',
  'which',
  'this',
  'that',
  'does',
  'with',
  'from',
  'have',
  'would',
  'could',
  'should',
  'there',
  'their',
  'about',
  'happens',
  'happen',
  'function',
  'code',
  'file',
  'why',
  'how',
  'the',
  'and',
  'for',
  'are',
  'not',
  'can',
  'will',
  'its',
  'into',
  'than',
  'then',
]);

class Pack {
  parts: string[] = [];
  ranges: AllowedRanges = new Map();
  items: string[] = [];
  used = 0;
  truncated = false;
  constructor(private readonly max: number) {}

  get remaining() {
    return this.max - this.used;
  }

  private addRange(path: string, a: number, b: number) {
    const arr = this.ranges.get(path) ?? [];
    arr.push([a, b]);
    this.ranges.set(path, arr);
  }

  /** Add numbered source lines from `path` (1-based inclusive), within `itemBudget` and the overall budget. */
  snippet(
    name: string,
    path: string,
    allLines: string[],
    from: number,
    to: number,
    itemBudget: number,
    note = '',
  ) {
    const a = Math.max(1, from);
    const b = Math.min(allLines.length, to);
    if (b < a) return;
    const budget = Math.min(itemBudget, this.remaining);
    if (budget <= 40) {
      this.truncated = true;
      return;
    }
    const out: string[] = [];
    let tokens = 20;
    let last = a - 1;
    for (let n = a; n <= b; n++) {
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
    if (out.length === 0) return;
    const header = `[${name}] file: ${path} lines ${a}-${last}${note ? ` (${note})` : ''}`;
    this.parts.push(`${header}\n${out.join('\n')}`);
    this.used += tokens;
    this.addRange(path, a, last);
    this.items.push(name);
  }

  text(name: string, body: string, itemBudget: number) {
    const budget = Math.min(itemBudget, this.remaining);
    if (budget <= 20) {
      this.truncated = true;
      return;
    }
    let b = body;
    if (estimateTokens(b) > budget) {
      b = `${b.slice(0, Math.floor(budget * 3.5))}\n…(truncated)`;
      this.truncated = true;
    }
    this.parts.push(`[${name}]\n${b}`);
    this.used += estimateTokens(b) + 5;
    this.items.push(name);
  }
}

function relationsText(
  rel: Relations | null,
  fileImports: Relations['imports'],
  resolved: ResolvedSelection,
): string {
  const L: string[] = [];
  if (!rel) {
    L.push(
      resolved.fileAnalysable
        ? 'No enclosing function/class symbol was found for this selection.'
        : 'This file is not analysed; no verified relations exist.',
    );
  } else {
    L.push(
      `Enclosing symbol: ${rel.symbol?.name ?? '?'} (${rel.symbol?.kind ?? '?'}) defined at ${rel.definedIn?.path}:${rel.definedIn?.line}`,
    );
    const fmt = (i: { label: string; path: string; line: number; provenance: string; via: string }) =>
      `- ${i.label} at ${i.path}:${i.line} [${i.provenance}; ${i.via}]`;
    L.push(
      rel.calledBy.length ? 'CALLED_BY / USED_BY:' : 'CALLED_BY / USED_BY: none found by static analysis',
    );
    L.push(...rel.calledBy.slice(0, 8).map(fmt));
    L.push(rel.calls.length ? 'CALLS:' : 'CALLS: none resolved to code in this repository');
    L.push(...rel.calls.slice(0, 10).map(fmt));
    if (rel.unresolved.length) {
      L.push('UNRESOLVED (could not be followed statically):');
      L.push(
        ...rel.unresolved
          .slice(0, 10)
          .map((u) => `- ${u.label} at ${u.path}:${u.line} (reason: ${u.reason})`),
      );
    }
  }
  const imps = (rel?.imports ?? fileImports).slice(0, 12);
  if (imps.length) {
    L.push('FILE_IMPORTS:');
    L.push(
      ...imps.map(
        (i) =>
          `- ${i.label}${i.path ? ` -> ${i.path}` : i.external ? ' (external package)' : ''} (line ${i.line})`,
      ),
    );
  }
  return L.join('\n');
}

function keywords(question: string): string[] {
  const words = question.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? [];
  const uniq: string[] = [];
  for (const w of words) {
    if (STOP.has(w.toLowerCase())) continue;
    if (!uniq.includes(w)) uniq.push(w);
  }
  return uniq.slice(0, 6);
}

export async function buildContextPack(o: BuildOpts): Promise<ContextPack> {
  const { db, snapshotId, selection, resolved } = o;
  const pack = new Pack(o.maxTokens);
  const file = await getFileContent(db, snapshotId, selection.path);
  const lines = file ? file.content.split('\n') : [];

  // 1. Selected code ± 5 lines.
  pack.snippet(
    'SELECTED_CODE',
    selection.path,
    lines,
    selection.startLine - 5,
    selection.endLine + 5,
    1200,
    `selected lines ${selection.startLine}-${selection.endLine}`,
  );

  // 2. Enclosing symbol body (when it adds more than the selection).
  const sym = resolved.symbol;
  if (sym && lines.length) {
    const already = selection.startLine - 5 <= sym.startLine && selection.endLine + 5 >= sym.endLine;
    if (!already)
      pack.snippet(
        'ENCLOSING_SYMBOL',
        sym.path,
        lines,
        sym.startLine,
        sym.endLine,
        1500,
        `${sym.kind} ${sym.name}`,
      );
  }

  // 3. Verified relations.
  let rel: Relations | null = null;
  if (sym) rel = await getRelations(db, snapshotId, sym.id);
  const fileImports = rel ? [] : await getFileImports(db, snapshotId, selection.path);
  pack.text('VERIFIED_RELATIONS', relationsText(rel, fileImports, resolved), 400 + (rel ? 200 : 0));

  if (rel) {
    // 4. Definitions of what the selection calls (first 15 lines each, max 5).
    let defBudget = 1500;
    const seen = new Set<string>();
    for (const c of rel.calls) {
      if (seen.size >= 5 || !c.symbolId) continue;
      if (seen.has(c.symbolId)) continue;
      seen.add(c.symbolId);
      const target = await getSymbol(db, snapshotId, c.symbolId);
      if (!target) continue;
      const tf =
        target.path === selection.path
          ? { content: lines.join('\n') }
          : await getFileContent(db, snapshotId, target.path);
      if (!tf) continue;
      const tl = tf.content.split('\n');
      const before = pack.used;
      pack.snippet(
        'DEFINITION',
        target.path,
        tl,
        target.startLine,
        Math.min(target.endLine, target.startLine + 14),
        Math.min(defBudget, 400),
        `definition of ${target.qualifiedName}`,
      );
      defBudget -= pack.used - before;
    }

    // 5. Callers: call-site ± 3 lines (max 3).
    let callerBudget = 800;
    for (const c of rel.calledBy.slice(0, 3)) {
      const cf = await getFileContent(db, snapshotId, c.path);
      if (!cf) continue;
      const before = pack.used;
      pack.snippet(
        'CALL_SITE',
        c.path,
        cf.content.split('\n'),
        c.line - 3,
        c.line + 3,
        Math.min(callerBudget, 300),
        `${c.label} -> ${sym?.name ?? ''}`,
      );
      callerBudget -= pack.used - before;
    }

    // 6. Callee signatures (max 6) as text.
    const sigs: string[] = [];
    for (const c of rel.calls.slice(0, 6)) {
      if (!c.symbolId) continue;
      const t = await getSymbol(db, snapshotId, c.symbolId);
      if (t?.signature) sigs.push(`- ${t.qualifiedName}: ${t.signature} (${t.path}:${t.startLine})`);
    }
    if (sigs.length) pack.text('CALLEE_SIGNATURES', sigs.join('\n'), 400);
  }

  // 7. File header imports.
  const importLines = lines
    .slice(0, 60)
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /^\s*(import\b|const\s.+=\s*require\(|.+\brequire\()/.test(l));
  if (importLines.length && lines.length) {
    const first = importLines[0]!.n;
    const last = importLines[importLines.length - 1]!.n;
    pack.snippet('FILE_HEADER', selection.path, lines, first, Math.min(last, first + 24), 300, 'imports');
  }

  // 8. Project facts.
  if (o.facts && (o.facts.frameworks.length || Object.keys(o.facts.languages).length)) {
    pack.text(
      'PROJECT_FACTS',
      `frameworks: ${o.facts.frameworks.join(', ') || 'none detected'}; languages (file counts): ${JSON.stringify(o.facts.languages)}`,
      150,
    );
  }

  // 9. Follow-ups only: lexical hits for identifiers in the question.
  if (o.question) {
    const words = keywords(o.question);
    let hitBudget = 900;
    let hits = 0;
    for (const w of words) {
      if (hits >= 3) break;
      const r = await db.query<{ path: string; content: string }>(
        `SELECT path, content FROM files WHERE snapshot_id=$1 AND analysable AND content ILIKE $2 ORDER BY path LIMIT 2`,
        [snapshotId, `%${w.replace(/[%_\\]/g, '\\$&')}%`],
      );
      for (const row of r.rows) {
        if (hits >= 3) break;
        const fl = row.content.split('\n');
        const idx = fl.findIndex((l) => l.toLowerCase().includes(w.toLowerCase()));
        if (idx < 0) continue;
        const n = idx + 1;
        const covered = pack.ranges.get(row.path)?.some(([a, b]) => n >= a && n <= b);
        if (covered) continue;
        const before = pack.used;
        pack.snippet('LEXICAL_HIT', row.path, fl, n - 3, n + 3, Math.min(hitBudget, 300), `mentions "${w}"`);
        if (pack.used > before) {
          hits++;
          hitBudget -= pack.used - before;
        }
      }
    }
  }

  const redacted = redact(pack.parts.join('\n\n'));
  return {
    text: redacted.text,
    ranges: pack.ranges,
    tokens: pack.used,
    relations: rel,
    items: pack.items,
    truncated: pack.truncated,
  };
}
