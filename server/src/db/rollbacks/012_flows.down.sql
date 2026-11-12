-- Reverts 012_flows.sql. Loses stored flows (recomputed by re-importing).
BEGIN;
ALTER TABLE analysis_runs DROP COLUMN flow_count;
DROP TABLE flow_steps;
DROP TABLE flows;
DELETE FROM schema_migrations WHERE name = '012_flows.sql';
COMMIT;
