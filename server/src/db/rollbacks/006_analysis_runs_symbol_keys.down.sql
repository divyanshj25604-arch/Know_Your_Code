-- Reverts 006_analysis_runs_symbol_keys.sql. Loses run history and stored symbol keys (both derivable again by
-- re-importing); symbols and edges themselves are kept.
BEGIN;
DROP INDEX IF EXISTS snapshots_current_run;
DROP INDEX IF EXISTS edges_run;
DROP INDEX IF EXISTS symbols_run;
DROP INDEX IF EXISTS symbols_snapshot_key;
DROP INDEX IF EXISTS symbols_run_key;
ALTER TABLE edges DROP COLUMN analysis_run_id;
ALTER TABLE symbols DROP COLUMN symbol_key, DROP COLUMN analysis_run_id;
ALTER TABLE snapshots DROP COLUMN current_analysis_run_id;
DROP TABLE analysis_runs;
DELETE FROM schema_migrations WHERE name = '006_analysis_runs_symbol_keys.sql';
COMMIT;
