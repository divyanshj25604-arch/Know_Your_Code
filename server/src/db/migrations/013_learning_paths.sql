-- P3.7: progress through learning paths. Path content is generated from each snapshot's analysis (not stored);
-- what is stored is the learner's progress per path and per item, keyed by durable item ids.
-- Rollback: server/src/db/rollbacks/013_learning_paths.down.sql
ALTER TABLE learning_progress DROP CONSTRAINT learning_progress_subject_kind_check;
ALTER TABLE learning_progress ADD CONSTRAINT learning_progress_subject_kind_check
  CHECK (subject_kind IN ('level', 'concept', 'file', 'symbol', 'path', 'lesson', 'mission', 'check'));
-- Answers submitted for a mission or check (a lesson or path has none).
ALTER TABLE learning_progress ADD COLUMN attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0);
