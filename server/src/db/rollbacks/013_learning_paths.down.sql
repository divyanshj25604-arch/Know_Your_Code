-- Reverts 013_learning_paths.sql. Loses learning-path progress (paths, lessons, missions, checks) and attempt counts.
BEGIN;
DELETE FROM learning_progress WHERE subject_kind IN ('path', 'lesson', 'mission', 'check');
ALTER TABLE learning_progress DROP COLUMN attempts;
ALTER TABLE learning_progress DROP CONSTRAINT learning_progress_subject_kind_check;
ALTER TABLE learning_progress ADD CONSTRAINT learning_progress_subject_kind_check
  CHECK (subject_kind IN ('level', 'concept', 'file', 'symbol'));
DELETE FROM schema_migrations WHERE name = '013_learning_paths.sql';
COMMIT;
