-- P0.4: one job per snapshot, so a re-run updates the existing job instead of adding a second runnable row.
-- Duplicates have never been written by the application (createSnapshot inserts exactly one job), but if any exist
-- the migration stops rather than deleting rows on its own. Rollback: server/src/db/rollbacks/004_job_integrity.down.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM jobs GROUP BY snapshot_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'jobs has more than one row for some snapshots; resolve them manually before migrating (SELECT snapshot_id, count(*) FROM jobs GROUP BY 1 HAVING count(*) > 1)';
  END IF;
END $$;

ALTER TABLE jobs ADD CONSTRAINT jobs_snapshot_unique UNIQUE (snapshot_id);
-- The unique constraint's index serves every lookup the plain index did.
DROP INDEX IF EXISTS jobs_snapshot;
