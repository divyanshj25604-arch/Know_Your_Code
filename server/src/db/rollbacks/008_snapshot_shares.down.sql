-- Reverts 008_snapshot_shares.sql. Revoked share links would become valid again until they expire (at most 7 days).
BEGIN;
ALTER TABLE snapshots DROP COLUMN shares_revoked_at;
DELETE FROM schema_migrations WHERE name = '008_snapshot_shares.sql';
COMMIT;
