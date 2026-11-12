-- Reverts 015_uploads.sql. Deletes uploaded repositories (and everything derived from them, including learning
-- history) because the pre-015 schema cannot tell them apart from GitHub repositories; also drops pending uploads.
BEGIN;
DROP TRIGGER IF EXISTS snapshots_release_upload ON snapshots;
DROP FUNCTION IF EXISTS snapshot_uploads_release();
DROP TABLE snapshot_uploads;
DELETE FROM repositories WHERE source = 'upload';
ALTER TABLE repositories DROP COLUMN source;
DELETE FROM schema_migrations WHERE name = '015_uploads.sql';
COMMIT;
