-- Reverts 010_architecture.sql. Loses stored module maps (recomputed by re-importing).
BEGIN;
ALTER TABLE analysis_runs DROP COLUMN monorepo;
DROP TABLE module_dependencies;
DROP TABLE module_files;
DROP TABLE modules;
DELETE FROM schema_migrations WHERE name = '010_architecture.sql';
COMMIT;
