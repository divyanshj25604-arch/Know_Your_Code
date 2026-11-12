import type { FlowDetail, FlowStepView, FlowSummary, FlowsView } from '@kyc/contracts';
import type { DiscoveredFlow } from '@kyc/core';
import type { Queryable } from '../db/pool';

/**
 * Store one run's request flows (P3.2). Call inside the content transaction, after symbols and edges are written.
 * A verified step is stored with the id of the call edge it stands for; if that edge cannot be found the step is
 * stored as unknown rather than as an unsupported "verified" claim.
 */
export async function persistFlows(
  q: Queryable,
  snapshotId: string,
  runId: string,
  fileIds: Map<string, string>,
  flows: DiscoveredFlow[],
): Promise<void> {
  await q.query('DELETE FROM flows WHERE snapshot_id=$1', [snapshotId]);
  const syms = await q.query<{ id: string; symbol_key: string }>(
    'SELECT id, symbol_key FROM symbols WHERE snapshot_id=$1 AND symbol_key IS NOT NULL',
    [snapshotId],
  );
  const symId = new Map(syms.rows.map((r) => [r.symbol_key, r.id]));
  const edgeRows = await q.query<{ id: string; s: string; t: string; line: number }>(
    `SELECT e.id::text AS id, ss.symbol_key AS s, ts.symbol_key AS t, e.line
     FROM edges e JOIN symbols ss ON ss.id = e.source_symbol_id JOIN symbols ts ON ts.id = e.target_symbol_id
     WHERE e.snapshot_id=$1 AND e.type='calls'`,
    [snapshotId],
  );
  const edgeId = new Map(edgeRows.rows.map((r) => [`${r.s}|${r.t}|${r.line}`, r.id]));
  for (const f of flows) {
    const r = await q.query<{ id: string }>(
      `INSERT INTO flows (snapshot_id, analysis_run_id, flow_key, method, route_path, name, client_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [snapshotId, runId, f.key, f.method, f.routePath, f.name, f.clients],
    );
    const id = r.rows[0]!.id;
    const steps = f.steps.map((s) => {
      const eid = s.edge
        ? (edgeId.get(`${s.edge.sourceKey}|${s.edge.targetKey}|${s.edge.line}`) ?? null)
        : null;
      const lost = s.provenance === 'verified' && !eid;
      return {
        ...s,
        kind: lost ? ('unknown' as const) : s.kind,
        provenance: lost ? ('unknown' as const) : s.provenance,
        reason: lost ? 'the call edge for this step was not stored' : s.reason,
        eid: lost ? null : eid,
      };
    });
    await q.query(
      `INSERT INTO flow_steps (flow_id, position, kind, label, file_id, line, symbol_id, symbol_key, provenance, depth,
                               reason, edge_id)
       SELECT $1, t.pos, t.kind, t.label, t.file_id, t.line, t.symbol_id, t.symbol_key, t.prov, t.depth, t.reason,
              t.edge_id::bigint
       FROM unnest($2::int[], $3::text[], $4::text[], $5::uuid[], $6::int[], $7::uuid[], $8::text[], $9::text[],
                   $10::int[], $11::text[], $12::text[])
            AS t(pos, kind, label, file_id, line, symbol_id, symbol_key, prov, depth, reason, edge_id)`,
      [
        id,
        steps.map((_, i) => i),
        steps.map((s) => s.kind),
        steps.map((s) => s.label),
        steps.map((s) => (s.path ? (fileIds.get(s.path) ?? null) : null)),
        steps.map((s) => s.line),
        steps.map((s) => (s.symbolKey ? (symId.get(s.symbolKey) ?? null) : null)),
        steps.map((s) => s.symbolKey),
        steps.map((s) => s.provenance),
        steps.map((s) => s.depth),
        steps.map((s) => s.reason),
        steps.map((s) => s.eid),
      ],
    );
  }
  await q.query('UPDATE analysis_runs SET flow_count=$2 WHERE id=$1', [runId, flows.length]);
}

const SUMMARY_SQL = `
  SELECT fl.id, fl.snapshot_id, fl.name, fl.method, fl.route_path, fl.client_count,
         (SELECT count(*)::int FROM flow_steps x WHERE x.flow_id = fl.id) AS step_count,
         (SELECT count(*)::int FROM flow_steps x WHERE x.flow_id = fl.id AND x.kind = 'unknown') AS unknown_count,
         h.symbol_id AS h_id, hs.qualified_name AS h_name, hf.path AS h_path, hs.start_line AS h_line
  FROM flows fl
  LEFT JOIN flow_steps h ON h.flow_id = fl.id AND h.kind = 'handler'
  LEFT JOIN symbols hs ON hs.id = h.symbol_id LEFT JOIN files hf ON hf.id = hs.file_id`;

interface SummaryRow {
  id: string;
  snapshot_id: string;
  name: string;
  method: string;
  route_path: string | null;
  client_count: number;
  step_count: number;
  unknown_count: number;
  h_id: string | null;
  h_name: string | null;
  h_path: string | null;
  h_line: number | null;
}

const summary = (r: SummaryRow): FlowSummary => ({
  id: r.id,
  name: r.name,
  method: r.method,
  routePath: r.route_path,
  clients: r.client_count,
  stepCount: r.step_count,
  unknownCount: r.unknown_count,
  handler:
    r.h_id && r.h_name && r.h_path && r.h_line
      ? { symbolId: r.h_id, name: r.h_name, path: r.h_path, line: r.h_line }
      : null,
});

/** The flows of a snapshot's current analysis run, in route-path order. */
export async function listFlows(q: Queryable, snapshotId: string): Promise<FlowsView> {
  const run = await q.query<{ flow_count: number | null }>(
    'SELECT r.flow_count FROM snapshots s JOIN analysis_runs r ON r.id = s.current_analysis_run_id WHERE s.id=$1',
    [snapshotId],
  );
  const rows = await q.query<SummaryRow>(
    `${SUMMARY_SQL}
     JOIN snapshots s ON s.id = fl.snapshot_id AND s.current_analysis_run_id = fl.analysis_run_id
     WHERE fl.snapshot_id=$1 ORDER BY fl.route_path NULLS LAST, fl.method, fl.flow_key`,
    [snapshotId],
  );
  return { available: (run.rows[0]?.flow_count ?? null) !== null, flows: rows.rows.map(summary) };
}

export async function flowSnapshot(q: Queryable, flowId: string): Promise<string | null> {
  const r = await q.query<{ snapshot_id: string }>('SELECT snapshot_id FROM flows WHERE id=$1', [flowId]);
  return r.rows[0]?.snapshot_id ?? null;
}

/** One flow with its ordered steps. */
export async function getFlow(q: Queryable, flowId: string): Promise<FlowDetail | null> {
  const head = await q.query<SummaryRow>(`${SUMMARY_SQL} WHERE fl.id=$1`, [flowId]);
  const h = head.rows[0];
  if (!h) return null;
  const steps = await q.query<{
    position: number;
    kind: FlowStepView['kind'];
    label: string;
    path: string | null;
    line: number | null;
    symbol_id: string | null;
    symbol_key: string | null;
    provenance: FlowStepView['provenance'];
    depth: number;
    reason: string | null;
    edge_id: string | null;
  }>(
    `SELECT st.position, st.kind, st.label, f.path, st.line, st.symbol_id, st.symbol_key, st.provenance, st.depth,
            st.reason, st.edge_id::text AS edge_id
     FROM flow_steps st LEFT JOIN files f ON f.id = st.file_id WHERE st.flow_id=$1 ORDER BY st.position`,
    [flowId],
  );
  return {
    ...summary(h),
    snapshotId: h.snapshot_id,
    steps: steps.rows.map((s) => ({
      index: s.position,
      kind: s.kind,
      label: s.label,
      path: s.path,
      line: s.line,
      symbolId: s.symbol_id,
      symbolKey: s.symbol_key,
      provenance: s.provenance,
      depth: s.depth,
      reason: s.reason,
      edgeId: s.edge_id,
    })),
  };
}
