-- Reverts 011_assessment_attempts.sql. LOSSY: attempt history beyond each check's latest answer (which stays in
-- check_attempts.answer/result) is dropped.
BEGIN;
ALTER TABLE check_attempts DROP COLUMN format;
DROP TABLE assessment_attempts;
DELETE FROM schema_migrations WHERE name = '011_assessment_attempts.sql';
COMMIT;
