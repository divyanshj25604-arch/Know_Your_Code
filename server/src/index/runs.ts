import type { StageInfo } from '@kyc/contracts';
import { ANALYSER_VERSION, SYMBOL_KEY_VERSION, type AnalysisResult } from '@kyc/core';
import type { Db, Queryable } from '../db/pool';

/** Diagnostics kept per run: enough to explain a partial analysis, bounded so a noisy repo cannot bloat the row. */
const MAX_DIAGNOSTICS = 200;
const MAX_DIAGNOSTIC_MESSAGE = 300;

/** Record the start of an analysis attempt for a snapshot. Every pipeline run gets one, success or not. */
export async function startRun(db: Queryable, snapshotId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO analysis_runs (snapshot_id, status, analyser_version, symbol_key_version)
     VALUES ($1, 'running', $2, $3) RETURNING id`,
    [snapshotId, ANALYSER_VERSION, SYMBOL_KEY_VERSION],
  );
  return r.rows[0]!.id;
}

/** Mark the run succeeded and make it the snapshot's current run. Call inside the content transaction. */
export async function completeRun(
  q: Queryable,
  runId: string,
  snapshotId: string,
  o: {
    outcome: 'ready' | 'ready_partial';
    stages: StageInfo[];
    files: number;
    symbols: number;
    edges: number;
    result: AnalysisResult;
  },
): Promise<void> {
  const diagnostics = o.result.diagnostics.slice(0, MAX_DIAGNOSTICS).map((d) => ({
    ...d,
    message: d.message.slice(0, MAX_DIAGNOSTIC_MESSAGE),
  }));
  await q.query(
    `UPDATE analysis_runs SET status='succeeded', finished_at=now(), outcome=$2, stages=$3, file_count=$4,
       symbol_count=$5, edge_count=$6, timings=$7, diagnostics=$8
     WHERE id=$1`,
    [
      runId,
      o.outcome,
      JSON.stringify(o.stages),
      o.files,
      o.symbols,
      o.edges,
      JSON.stringify(o.result.timings),
      JSON.stringify(diagnostics),
    ],
  );
  await q.query('UPDATE snapshots SET current_analysis_run_id=$2 WHERE id=$1', [snapshotId, runId]);
}

export async function failRun(q: Queryable, runId: string, errorCode: string): Promise<void> {
  await q.query(
    `UPDATE analysis_runs SET status='failed', finished_at=now(), error_code=$2 WHERE id=$1 AND status='running'`,
    [runId, errorCode],
  );
}

/** The snapshot's current succeeded run, whose rows are what readers see. */
export async function currentRun(
  q: Queryable,
  snapshotId: string,
): Promise<{ id: string; outcome: 'ready' | 'ready_partial'; stages: StageInfo[] } | null> {
  const r = await q.query<{ id: string; outcome: 'ready' | 'ready_partial'; stages: StageInfo[] | null }>(
    `SELECT r.id, r.outcome, r.stages FROM snapshots s JOIN analysis_runs r ON r.id = s.current_analysis_run_id
     WHERE s.id=$1 AND r.status='succeeded'`,
    [snapshotId],
  );
  const row = r.rows[0];
  return row ? { id: row.id, outcome: row.outcome, stages: row.stages ?? [] } : null;
}

/** On boot: runs left "running" by a process that died can never finish. Single-instance assumption (T16). */
export async function failInterruptedRuns(db: Db): Promise<number> {
  const r = await db.query(
    `UPDATE analysis_runs SET status='failed', finished_at=now(), error_code='INTERRUPTED' WHERE status='running'`,
  );
  return r.rowCount ?? 0;
}

/**
 * After a run replaces a snapshot's symbol rows, point each explanation made on that snapshot back at the symbol
 * with the same stable key (the old row was deleted, which cleared the link). Explanations whose symbol no longer
 * exists keep a null link but retain the key. Call inside the content transaction.
 */
export async function relinkExplanationSymbols(q: Queryable, snapshotId: string): Promise<number> {
  const r = await q.query(
    `UPDATE explanations e SET symbol_id = s.id
     FROM symbols s
     WHERE e.snapshot_id = $1 AND e.symbol_key IS NOT NULL
       AND s.snapshot_id = $1 AND md5(s.symbol_key) = md5(e.symbol_key) AND s.symbol_key = e.symbol_key
       AND e.symbol_id IS DISTINCT FROM s.id`,
    [snapshotId],
  );
  return r.rowCount ?? 0;
}
