import type { Relations } from '@kyc/contracts';
import { redact } from '../privacy/redact';
import type { GraphStore, GraphSymbol } from './graph';
import { Pack, type AllowedRanges } from './pack';
import { importItems, relationsOf } from './relations';

/**
 * Intent-specific retrieval plans over a GraphStore (P2.4). Every plan is deterministic (the same selection on the
 * same snapshot gives the same pack), bounded by `maxTokens`, sends each source line at most once, and records which
 * graph edges the model was shown so that "verified" claims can be checked against them (P2.3).
 */
export type RetrievalIntent = 'explain' | 'followup' | 'concept' | 'assess' | 'flow';

export interface PlanRequest {
  intent: RetrievalIntent;
  selection: { path: string; startLine: number; endLine: number };
  /** The enclosing function/method/class of the selection, or the flow's start symbol. */
  focus: GraphSymbol | null;
  fileAnalysable: boolean;
  /** Follow-up question: enables lexical search. */
  question?: string;
  maxTokens: number;
  facts?: { frameworks: string[]; languages: Record<string, number> } | null;
  /** Flow plans only: how many call hops to follow from the focus (1–4, default 3). */
  hops?: number;
}

/** A graph edge the model was shown, citable as evidence. */
export interface EvidenceEdge {
  id: string;
  type: string;
  from: string;
  to: string;
  path: string;
  line: number;
}

export interface FlowStep {
  hop: number;
  edgeId: string;
  from: { id: string; name: string };
  to: { id: string; key: string | null; name: string; path: string; line: number };
  /** Call site. */
  path: string;
  line: number;
}

export interface ContextPack {
  /** Text placed inside <repository_content>, redacted. */
  text: string;
  ranges: AllowedRanges;
  tokens: number;
  relations: Relations | null;
  /** Edges shown to the model (VERIFIED_RELATIONS and FLOW), by id. */
  edges: Map<string, EvidenceEdge>;
  flow: FlowStep[];
  items: string[];
  truncated: boolean;
}

const STOP = new Set(
  'what when where which this that does with from have would could should there their about happens happen function code file why how the and for are not can will its into than then'.split(
    ' ',
  ),
);

function keywords(question: string): string[] {
  const out: string[] = [];
  for (const w of question.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? []) {
    if (!STOP.has(w.toLowerCase()) && !out.includes(w)) out.push(w);
  }
  return out.slice(0, 6);
}

function relationsText(rel: Relations | null, imports: Relations['imports'], fileAnalysable: boolean): string {
  const L: string[] = [];
  if (!rel) {
    L.push(
      fileAnalysable
        ? 'No enclosing function/class symbol was found for this selection.'
        : 'This file is not analysed; no verified relations exist.',
    );
  } else {
    L.push(
      `Enclosing symbol: ${rel.symbol?.name ?? '?'} (${rel.symbol?.kind ?? '?'}) defined at ${rel.definedIn?.path}:${rel.definedIn?.line}`,
    );
    const fmt = (i: { label: string; path: string; line: number; provenance: string; via: string; edgeId?: string }) =>
      `- ${i.label} at ${i.path}:${i.line} [${i.provenance}; ${i.via}${i.edgeId ? `; edge ${i.edgeId}` : ''}]`;
    L.push(rel.calledBy.length ? 'CALLED_BY / USED_BY:' : 'CALLED_BY / USED_BY: none found by static analysis');
    L.push(...rel.calledBy.slice(0, 8).map(fmt));
    L.push(rel.calls.length ? 'CALLS:' : 'CALLS: none resolved to code in this repository');
    L.push(...rel.calls.slice(0, 10).map(fmt));
    if (rel.unresolved.length) {
      L.push('UNRESOLVED (could not be followed statically):');
      L.push(...rel.unresolved.slice(0, 10).map((u) => `- ${u.label} at ${u.path}:${u.line} (reason: ${u.reason})`));
    }
  }
  const imps = imports.slice(0, 12);
  if (imps.length) {
    L.push('FILE_IMPORTS:');
    L.push(
      ...imps.map(
        (i) => `- ${i.label}${i.path ? ` -> ${i.path}` : i.external ? ' (external package)' : ''} (line ${i.line})`,
      ),
    );
  }
  return L.join('\n');
}

/** Memoised file lines for one plan (a file is read once however many snippets come from it). */
function fileCache(store: GraphStore) {
  const cache = new Map<string, Promise<string[] | null>>();
  return (path: string) => {
    let p = cache.get(path);
    if (!p) {
      p = store.fileText(path).then((t) => (t === null ? null : t.split('\n')));
      cache.set(path, p);
    }
    return p;
  };
}

export async function planContext(store: GraphStore, req: PlanRequest): Promise<ContextPack> {
  const pack = new Pack(req.maxTokens);
  const lines = fileCache(store);
  const edges = new Map<string, EvidenceEdge>();
  const flow: FlowStep[] = [];
  const sel = req.selection;
  const sym = req.focus;
  const selLines = (await lines(sel.path)) ?? [];

  // 1. The selection ± 5 lines (for a flow: the start symbol's opening lines).
  pack.snippet('SELECTED_CODE', sel.path, selLines, sel.startLine - 5, sel.endLine + 5, 1200, `selected lines ${sel.startLine}-${sel.endLine}`);

  // 2. The enclosing symbol's body, when it adds more than the selection.
  if (sym && selLines.length && !(sel.startLine - 5 <= sym.startLine && sel.endLine + 5 >= sym.endLine)) {
    pack.snippet('ENCLOSING_SYMBOL', sym.path, selLines, sym.startLine, sym.endLine, 1500, `${sym.kind} ${sym.name}`);
  }

  // 3. Verified one-hop relations, each with its edge id.
  const rel = sym ? await relationsOf(store, sym.id) : null;
  const imports = rel ? rel.imports : importItems(await store.fileImports(sel.path));
  pack.text('VERIFIED_RELATIONS', relationsText(rel, imports, req.fileAnalysable), 400 + (rel ? 200 : 0));
  if (rel && sym) {
    for (const c of [...rel.calledBy.slice(0, 8), ...rel.calls.slice(0, 10)]) {
      if (!c.edgeId || c.provenance !== 'verified') continue;
      const incoming = rel.calledBy.includes(c);
      edges.set(c.edgeId, {
        id: c.edgeId,
        type: c.via,
        from: incoming ? c.label : sym.name,
        to: incoming ? sym.name : c.label,
        path: c.path,
        line: c.line,
      });
    }
  }

  if (req.intent === 'flow' && sym) await planFlow(store, req, sym, pack, lines, edges, flow);
  else if (rel && sym) {
    // 4. Definitions of what the selection calls (first 15 lines each, at most 5).
    let defBudget = 1500;
    for (const c of rel.calls.filter((x) => x.symbolId).slice(0, 5)) {
      const target = await store.symbol(c.symbolId!);
      const tl = target ? await lines(target.path) : null;
      if (!target || !tl) continue;
      const before = pack.used;
      pack.snippet('DEFINITION', target.path, tl, target.startLine, Math.min(target.endLine, target.startLine + 14), Math.min(defBudget, 400), `definition of ${target.name}`);
      defBudget -= pack.used - before;
    }
    // 5. Callers: call site ± 3 lines (at most 3).
    let callerBudget = 800;
    for (const c of rel.calledBy.slice(0, 3)) {
      const cl = await lines(c.path);
      if (!cl) continue;
      const before = pack.used;
      pack.snippet('CALL_SITE', c.path, cl, c.line - 3, c.line + 3, Math.min(callerBudget, 300), `${c.label} -> ${sym.name}`);
      callerBudget -= pack.used - before;
    }
    // 6. Callee signatures (at most 6).
    const sigs: string[] = [];
    for (const c of rel.calls.slice(0, 6)) {
      const t = c.symbolId ? await store.symbol(c.symbolId) : null;
      if (t?.signature) sigs.push(`- ${t.name}: ${t.signature} (${t.path}:${t.startLine})`);
    }
    if (sigs.length) pack.text('CALLEE_SIGNATURES', sigs.join('\n'), 400);
  }

  // 7. File header imports.
  const importLines = selLines
    .slice(0, 60)
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /^\s*(import\b|const\s.+=\s*require\(|.+\brequire\()/.test(l));
  if (importLines.length) {
    const first = importLines[0]!.n;
    const last = importLines[importLines.length - 1]!.n;
    pack.snippet('FILE_HEADER', sel.path, selLines, first, Math.min(last, first + 24), 300, 'imports');
  }

  // 8. Project facts.
  if (req.facts && (req.facts.frameworks.length || Object.keys(req.facts.languages).length)) {
    pack.text(
      'PROJECT_FACTS',
      `frameworks: ${req.facts.frameworks.join(', ') || 'none detected'}; languages (file counts): ${JSON.stringify(req.facts.languages)}`,
      150,
    );
  }

  // 9. Follow-ups: lexical hits for identifiers in the question, never lines already shown.
  if (req.intent === 'followup' && req.question) {
    let hitBudget = 900;
    let hits = 0;
    for (const w of keywords(req.question)) {
      if (hits >= 3) break;
      for (const row of await store.lexical(w, 2)) {
        if (hits >= 3) break;
        const fl = row.content.split('\n');
        const idx = fl.findIndex((l) => l.toLowerCase().includes(w.toLowerCase()));
        if (idx < 0) continue;
        const n = idx + 1;
        if (pack.ranges.get(row.path)?.some(([a, b]) => n >= a && n <= b)) continue;
        const before = pack.used;
        pack.snippet('LEXICAL_HIT', row.path, fl, n - 3, n + 3, Math.min(hitBudget, 300), `mentions "${w}"`);
        if (pack.used > before) {
          hits++;
          hitBudget -= pack.used - before;
        }
      }
    }
  }

  return {
    text: redact(pack.parts.join('\n\n')).text,
    ranges: pack.ranges,
    tokens: pack.used,
    relations: rel,
    edges,
    flow,
    items: pack.items,
    truncated: pack.truncated,
  };
}

const MAX_HOPS = 4;
const FANOUT_PER_SYMBOL = 4;
const STEPS_PER_HOP = 8;

/**
 * Follow verified call edges breadth-first from the focus symbol, up to `hops` hops. Each new callee contributes its
 * definition's opening lines; the budget is shared so deeper hops get what is left. Order is deterministic (the
 * store's outbound order), each symbol is visited once, and fan-out is capped per symbol and per hop.
 */
async function planFlow(
  store: GraphStore,
  req: PlanRequest,
  start: GraphSymbol,
  pack: Pack,
  lines: (p: string) => Promise<string[] | null>,
  edges: Map<string, EvidenceEdge>,
  flow: FlowStep[],
) {
  const hops = Math.min(Math.max(1, req.hops ?? 3), MAX_HOPS);
  const visited = new Set([start.id]);
  let frontier: GraphSymbol[] = [start];
  for (let hop = 1; hop <= hops && frontier.length; hop++) {
    const next: GraphSymbol[] = [];
    for (const from of frontier) {
      if (next.length >= STEPS_PER_HOP) break;
      let fan = 0;
      for (const e of await store.outbound(from.id)) {
        if (e.type !== 'calls' || e.reason || e.provenance !== 'verified' || !e.target.id) continue;
        if (visited.has(e.target.id) || fan >= FANOUT_PER_SYMBOL || next.length >= STEPS_PER_HOP) continue;
        const target = await store.symbol(e.target.id);
        if (!target) continue;
        visited.add(target.id);
        next.push(target);
        fan++;
        flow.push({
          hop,
          edgeId: e.id,
          from: { id: from.id, name: from.name },
          to: { id: target.id, key: target.key, name: target.name, path: target.path, line: target.startLine },
          path: e.source.path,
          line: e.line,
        });
        edges.set(e.id, { id: e.id, type: 'call', from: from.name, to: target.name, path: e.source.path, line: e.line });
      }
    }
    // Definitions for this hop share what is left of the budget with later hops.
    const share = Math.floor(pack.remaining / Math.max(1, hops - hop + 2));
    let hopBudget = Math.max(0, share);
    for (const t of next) {
      const tl = await lines(t.path);
      if (!tl || hopBudget <= 40) continue;
      const before = pack.used;
      pack.snippet(`FLOW_HOP_${hop}`, t.path, tl, t.startLine, Math.min(t.endLine, t.startLine + 14), Math.min(hopBudget, 400), `definition of ${t.name}`);
      hopBudget -= pack.used - before;
    }
    frontier = next;
  }
  if (flow.length) {
    pack.text(
      'FLOW',
      flow.map((s) => `- hop ${s.hop}: ${s.from.name} calls ${s.to.name} at ${s.path}:${s.line} [verified; edge ${s.edgeId}]`).join('\n'),
      500,
    );
  } else {
    pack.text('FLOW', `No verified calls from ${start.name} to code in this repository.`, 60);
  }
}
