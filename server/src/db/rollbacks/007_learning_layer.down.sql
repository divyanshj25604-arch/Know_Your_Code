-- Reverts 007_learning_layer.sql.
-- Restores archived orphan feedback. Progress, bookmarks and positions created after the migration are dropped
-- (LOSSY for that data), and explanations whose snapshot was already deleted cannot return under a NOT NULL,
-- cascading snapshot_id: the script refuses while such rows exist. Delete them deliberately first if intended.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM explanations WHERE snapshot_id IS NULL) THEN
    RAISE EXCEPTION 'explanations without a snapshot exist (kept history); rolling back 007 would need to delete them';
  END IF;
END $$;
DROP TABLE learner_positions;
DROP TABLE bookmarks;
DROP TABLE learning_progress;

ALTER TABLE feedback DROP CONSTRAINT feedback_owner_target, DROP CONSTRAINT feedback_one_typed_target,
  DROP CONSTRAINT feedback_target_type_known;
ALTER TABLE feedback ADD COLUMN target_id_plain uuid;
UPDATE feedback SET target_id_plain = target_id;
ALTER TABLE feedback DROP COLUMN target_id;
ALTER TABLE feedback RENAME COLUMN target_id_plain TO target_id;
ALTER TABLE feedback ALTER COLUMN target_id SET NOT NULL;
ALTER TABLE feedback DROP COLUMN explanation_id, DROP COLUMN message_id, DROP COLUMN check_attempt_id;
INSERT INTO feedback (id, owner_id, target_type, target_id, rating, reason, comment, created_at)
  SELECT id, owner_id, target_type, target_id, rating, reason, comment, created_at FROM feedback_orphans;
DROP TABLE feedback_orphans;
ALTER TABLE feedback ADD CONSTRAINT feedback_owner_id_target_type_target_id_key UNIQUE (owner_id, target_type, target_id);

DROP INDEX IF EXISTS explanations_owner_key;
DROP INDEX IF EXISTS explanations_snapshot_repository;
DROP INDEX IF EXISTS explanations_repository_owner;
DROP INDEX IF EXISTS explanations_repository;
ALTER TABLE explanations DROP CONSTRAINT explanations_repository_owner,
  DROP CONSTRAINT explanations_snapshot_in_repository;
ALTER TABLE explanations ALTER COLUMN snapshot_id SET NOT NULL;
ALTER TABLE explanations ADD CONSTRAINT explanations_snapshot_id_fkey FOREIGN KEY (snapshot_id)
  REFERENCES snapshots(id) ON DELETE CASCADE;
ALTER TABLE explanations DROP COLUMN commit_sha, DROP COLUMN symbol_key, DROP COLUMN repository_id;

ALTER TABLE snapshots DROP CONSTRAINT snapshots_id_repository;
ALTER TABLE repositories DROP CONSTRAINT repositories_id_owner;
DELETE FROM schema_migrations WHERE name = '007_learning_layer.sql';
COMMIT;
