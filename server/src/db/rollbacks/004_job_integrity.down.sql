-- Reverts 004_job_integrity.sql. Lossless: only a constraint and an index change.
BEGIN;
CREATE INDEX IF NOT EXISTS jobs_snapshot ON jobs (snapshot_id);
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_snapshot_unique;
DELETE FROM schema_migrations WHERE name = '004_job_integrity.sql';
COMMIT;
