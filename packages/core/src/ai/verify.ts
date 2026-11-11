import type { Claim, Evidence, Ref } from '@kyc/contracts';
import { isAllowed, type AllowedRanges } from '../retrieval/pack';
import type { EvidenceEdge } from '../retrieval/planner';

export interface VerifyStats {
  total: number;
  stripped: number;
}

/**
 * Keep only references to files and lines that were in the context pack. A reference the model invented, or one
 * outside what it was shown, is removed; the surrounding text is kept.
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
  return lines.filter((l) => {
    stats.total++;
    const good = path !== null && isAllowed(ranges, { path, line: l });
    if (!good) stats.stripped++;
    return good;
  });
}

/**
 * Check every claim against what the model was shown. Line evidence must lie in the pack's ranges; edge evidence
 * must be an edge the pack contained, and is rewritten from the pack (never trusted from the model). A claim marked
 * `verified` keeps that label only if at least one valid edge remains; otherwise it becomes `explained`.
 */
export function verifyClaims(
  claims: Claim[],
  ranges: AllowedRanges,
  edges: Map<string, EvidenceEdge>,
  stats: VerifyStats,
): { claims: Claim[]; downgraded: number } {
  let downgraded = 0;
  const out = claims.map((c) => {
    const evidence: Evidence[] = [];
    for (const e of c.evidence) {
      stats.total++;
      if (e.kind === 'lines') {
        if (isAllowed(ranges, e)) evidence.push(e);
        else stats.stripped++;
      } else {
        const known = edges.get(e.edgeId);
        if (known)
          evidence.push({
            kind: 'edge',
            edgeId: known.id,
            type: known.type,
            from: known.from,
            to: known.to,
            path: known.path,
            line: known.line,
          });
        else stats.stripped++;
      }
    }
    let provenance = c.provenance;
    if (provenance === 'verified' && !evidence.some((e) => e.kind === 'edge')) {
      provenance = 'explained';
      downgraded++;
    }
    return { text: c.text, provenance, evidence };
  });
  return { claims: out, downgraded };
}

/** Claims for graph-proven relations, built deterministically from the edges the model was shown. */
export function edgeClaims(edges: Map<string, EvidenceEdge>): Claim[] {
  return [...edges.values()].map((e) => ({
    text: `${e.from} ${e.type === 'call' ? 'calls' : e.type === 'route' ? 'registers' : 'uses'} ${e.to}`,
    provenance: 'verified' as const,
    evidence: [
      {
        kind: 'edge' as const,
        edgeId: e.id,
        type: e.type,
        from: e.from,
        to: e.to,
        path: e.path,
        line: e.line,
      },
    ],
  }));
}
