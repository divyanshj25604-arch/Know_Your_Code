-- P1.3: stable symbol keys and analysis-run records. Rollback: server/src/db/rollbacks/006_analysis_runs_symbol_keys.down.sql
--
-- A snapshot is one commit's files; an analysis run is one attempt to analyse them. Runs are kept for the snapshot's
-- lifetime (history: analyser version, outcome, counts, timings, diagnostics, failure code), so one commit can be
-- analysed more than once. Symbols and edges belong to exactly one run; the snapshot points at the run whose rows are
-- current. `symbols.symbol_key` is the durable identity of a declaration (identical for unchanged code across runs
-- and snapshots); `symbols.id` stays a per-run row id for joins.
CREATE TABLE analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  analyser_version text NOT NULL,
  symbol_key_version int NOT NULL CHECK (symbol_key_version >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- The snapshot status this run produced (ready or ready_partial) and the stages shown at that moment, so a failed
  -- later run can restore the snapshot to this run's state.
  outcome text CHECK (outcome IN ('ready', 'ready_partial')),
  stages jsonb,
  file_count int,
  symbol_count int,
  edge_count int,
  timings jsonb NOT NULL DEFAULT '{}',
  diagnostics jsonb NOT NULL DEFAULT '[]',
  error_code text,
  CHECK (status = 'running' OR finished_at IS NOT NULL),
  CHECK ((status = 'succeeded') = (outcome IS NOT NULL))
);
CREATE INDEX analysis_runs_snapshot ON analysis_runs (snapshot_id, started_at);
CREATE INDEX analysis_runs_running ON analysis_runs (status) WHERE status = 'running';

ALTER TABLE snapshots ADD COLUMN current_analysis_run_id uuid REFERENCES analysis_runs(id) ON DELETE SET NULL;
ALTER TABLE symbols
  ADD COLUMN analysis_run_id uuid REFERENCES analysis_runs(id) ON DELETE CASCADE,
  ADD COLUMN symbol_key text;
ALTER TABLE edges ADD COLUMN analysis_run_id uuid REFERENCES analysis_runs(id) ON DELETE CASCADE;

-- Backfill: every snapshot that already has analysed rows gets one 'legacy' run. Keys cannot be computed for those
-- rows without re-analysing (the source positions they were derived from are gone), so they stay NULL with key
-- version 0; they disappear with normal 7-day retention or are replaced when the commit is re-imported.
INSERT INTO analysis_runs (snapshot_id, status, analyser_version, symbol_key_version, started_at, finished_at,
                           outcome, stages, symbol_count, edge_count)
SELECT s.id, 'succeeded', 'legacy', 0, s.created_at, s.created_at,
       CASE WHEN s.status = 'ready_partial' THEN 'ready_partial' ELSE 'ready' END, s.stages,
       (SELECT count(*) FROM symbols y WHERE y.snapshot_id = s.id),
       (SELECT count(*) FROM edges e WHERE e.snapshot_id = s.id)
FROM snapshots s
WHERE EXISTS (SELECT 1 FROM symbols y WHERE y.snapshot_id = s.id)
   OR EXISTS (SELECT 1 FROM edges e WHERE e.snapshot_id = s.id);
UPDATE symbols y SET analysis_run_id = r.id FROM analysis_runs r WHERE r.snapshot_id = y.snapshot_id;
UPDATE edges e SET analysis_run_id = r.id FROM analysis_runs r WHERE r.snapshot_id = e.snapshot_id;
UPDATE snapshots s SET current_analysis_run_id = r.id FROM analysis_runs r WHERE r.snapshot_id = s.id;

ALTER TABLE symbols ALTER COLUMN analysis_run_id SET NOT NULL;
ALTER TABLE edges ALTER COLUMN analysis_run_id SET NOT NULL;

-- Keys are unique within a run. md5() keeps the index entry small whatever the key length (deeply nested names in
-- long paths); lookups compare both md5(symbol_key) and symbol_key.
CREATE UNIQUE INDEX symbols_run_key ON symbols (analysis_run_id, md5(symbol_key)) WHERE symbol_key IS NOT NULL;
CREATE INDEX symbols_snapshot_key ON symbols (snapshot_id, md5(symbol_key)) WHERE symbol_key IS NOT NULL;
-- Foreign-key indexes: without them, deleting a run or snapshot scans these tables once per row (see 003).
CREATE INDEX symbols_run ON symbols (analysis_run_id);
CREATE INDEX edges_run ON edges (analysis_run_id);
CREATE INDEX snapshots_current_run ON snapshots (current_analysis_run_id);
