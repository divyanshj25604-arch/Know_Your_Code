-- Reverts 009_ai_capabilities.sql. Loses stored claims and capability versions (answers themselves are kept).
BEGIN;
ALTER TABLE messages DROP COLUMN claims, DROP COLUMN capability_version, DROP COLUMN capability;
ALTER TABLE explanations DROP COLUMN claims, DROP COLUMN capability_version, DROP COLUMN capability;
DELETE FROM schema_migrations WHERE name = '009_ai_capabilities.sql';
COMMIT;
