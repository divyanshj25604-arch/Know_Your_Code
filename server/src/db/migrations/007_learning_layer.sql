-- P1.4: the learning layer outlives the code layer. Rollback: server/src/db/rollbacks/007_learning_layer.down.sql
--
-- Code rows (snapshots, files, symbols, edges) expire after RETENTION_DAYS. Learning rows (explanations and their
-- messages and checks, feedback, progress, bookmarks, positions) now hang off the durable repository row and refer
-- to code by stable keys, so retention deletes code but keeps learning history. Deleting a repository on request
-- still deletes everything about it, learning history included.
--
-- Every learning row carries (repository_id, user_id) with a composite foreign key to repositories(id, owner_id):
-- the database itself refuses a row that points at another user's repository. The keys are DEFERRABLE so a single
-- transaction (claiming anonymous work) can move a repository and its rows together.

DO $$
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'PostgreSQL 15 or later is required (ON DELETE SET NULL with a column list); found %',
      current_setting('server_version');
  END IF;
END $$;

ALTER TABLE repositories ADD CONSTRAINT repositories_id_owner UNIQUE (id, owner_id);
ALTER TABLE snapshots ADD CONSTRAINT snapshots_id_repository UNIQUE (id, repository_id);

-- ---------------------------------------------------------------- explanations

ALTER TABLE explanations
  ADD COLUMN repository_id uuid,
  ADD COLUMN symbol_key text,
  ADD COLUMN commit_sha text;
UPDATE explanations e SET repository_id = s.repository_id, commit_sha = s.commit_sha
  FROM snapshots s WHERE s.id = e.snapshot_id;
UPDATE explanations e SET symbol_key = y.symbol_key FROM symbols y WHERE y.id = e.symbol_id;
ALTER TABLE explanations ALTER COLUMN repository_id SET NOT NULL;

-- Snapshot link: kept while the snapshot exists, cleared (not cascaded) when retention deletes it.
ALTER TABLE explanations DROP CONSTRAINT explanations_snapshot_id_fkey;
ALTER TABLE explanations ALTER COLUMN snapshot_id DROP NOT NULL;
ALTER TABLE explanations
  ADD CONSTRAINT explanations_snapshot_in_repository FOREIGN KEY (snapshot_id, repository_id)
    REFERENCES snapshots (id, repository_id) ON DELETE SET NULL (snapshot_id) ON UPDATE CASCADE
    DEFERRABLE INITIALLY IMMEDIATE,
  ADD CONSTRAINT explanations_repository_owner FOREIGN KEY (repository_id, owner_id)
    REFERENCES repositories (id, owner_id) ON DELETE CASCADE ON UPDATE CASCADE
    DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX explanations_repository ON explanations (repository_id);
CREATE INDEX explanations_repository_owner ON explanations (repository_id, owner_id);
CREATE INDEX explanations_snapshot_repository ON explanations (snapshot_id, repository_id);
CREATE INDEX explanations_owner_key ON explanations (owner_id, repository_id, md5(symbol_key))
  WHERE symbol_key IS NOT NULL;
-- messages and check_attempts cascade from explanations only, so they now share the explanation's lifetime.

-- ---------------------------------------------------------------- feedback: typed targets

ALTER TABLE feedback
  ADD COLUMN explanation_id uuid REFERENCES explanations(id) ON DELETE CASCADE,
  ADD COLUMN message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  ADD COLUMN check_attempt_id uuid REFERENCES check_attempts(id) ON DELETE CASCADE;
UPDATE feedback f SET explanation_id = f.target_id
  WHERE f.target_type = 'explanation' AND EXISTS (SELECT 1 FROM explanations x WHERE x.id = f.target_id);
UPDATE feedback f SET message_id = f.target_id
  WHERE f.target_type = 'message' AND EXISTS (SELECT 1 FROM messages x WHERE x.id = f.target_id);
UPDATE feedback f SET check_attempt_id = f.target_id
  WHERE f.target_type = 'check' AND EXISTS (SELECT 1 FROM check_attempts x WHERE x.id = f.target_id);

-- Feedback whose target was already deleted (possible under the old snapshot cascade) is moved, not destroyed:
-- it is kept in feedback_orphans for audit and restored by the rollback script.
CREATE TABLE feedback_orphans (LIKE feedback INCLUDING DEFAULTS);
ALTER TABLE feedback_orphans
  DROP COLUMN explanation_id, DROP COLUMN message_id, DROP COLUMN check_attempt_id,
  ADD COLUMN archived_at timestamptz NOT NULL DEFAULT now();
INSERT INTO feedback_orphans (id, owner_id, target_type, target_id, rating, reason, comment, created_at)
  SELECT id, owner_id, target_type, target_id, rating, reason, comment, created_at FROM feedback
  WHERE explanation_id IS NULL AND message_id IS NULL AND check_attempt_id IS NULL;
DELETE FROM feedback WHERE explanation_id IS NULL AND message_id IS NULL AND check_attempt_id IS NULL;

-- target_id becomes derived from the typed column, so the two can never disagree; the one-vote-per-target rule
-- (owner, type, target) keeps working unchanged.
ALTER TABLE feedback DROP CONSTRAINT feedback_owner_id_target_type_target_id_key;
ALTER TABLE feedback DROP COLUMN target_id;
ALTER TABLE feedback
  ADD COLUMN target_id uuid GENERATED ALWAYS AS (COALESCE(explanation_id, message_id, check_attempt_id)) STORED,
  ADD CONSTRAINT feedback_target_type_known CHECK (target_type IN ('explanation', 'message', 'check')),
  ADD CONSTRAINT feedback_one_typed_target CHECK (
    (target_type = 'explanation' AND explanation_id IS NOT NULL AND message_id IS NULL AND check_attempt_id IS NULL)
    OR (target_type = 'message' AND message_id IS NOT NULL AND explanation_id IS NULL AND check_attempt_id IS NULL)
    OR (target_type = 'check' AND check_attempt_id IS NOT NULL AND explanation_id IS NULL AND message_id IS NULL)
  ),
  ADD CONSTRAINT feedback_owner_target UNIQUE (owner_id, target_type, target_id);
CREATE INDEX feedback_explanation ON feedback (explanation_id) WHERE explanation_id IS NOT NULL;
CREATE INDEX feedback_message ON feedback (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX feedback_check_attempt ON feedback (check_attempt_id) WHERE check_attempt_id IS NOT NULL;

-- ---------------------------------------------------------------- learning progress

-- What a learner has started or completed in one repository. A subject is a learning level, a concept from the
-- shared vocabulary, a file path, or a symbol by its stable key. The curriculum itself (paths, lessons, missions)
-- is not modelled yet (P3.7).
CREATE TABLE learning_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id uuid NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('level', 'concept', 'file', 'symbol')),
  subject_key text NOT NULL CHECK (char_length(subject_key) BETWEEN 1 AND 4096),
  status text NOT NULL CHECK (status IN ('started', 'completed')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK (subject_kind <> 'level' OR subject_key IN
    ('project', 'application', 'concept', 'exploration', 'interactive', 'validation')),
  FOREIGN KEY (repository_id, user_id) REFERENCES repositories (id, owner_id)
    ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE UNIQUE INDEX learning_progress_subject
  ON learning_progress (user_id, repository_id, subject_kind, md5(subject_key));
CREATE INDEX learning_progress_repository_user ON learning_progress (repository_id, user_id);

-- ---------------------------------------------------------------- bookmarks

-- A saved place in a repository: a file, optionally a symbol (stable key) and a line range, plus the commit it was
-- made against so it can be re-anchored when the code changes.
CREATE TABLE bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id uuid NOT NULL,
  path text NOT NULL CHECK (char_length(path) BETWEEN 1 AND 1024),
  symbol_key text CHECK (symbol_key IS NULL OR char_length(symbol_key) BETWEEN 1 AND 4096),
  start_line int,
  end_line int,
  commit_sha text CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{40}$'),
  label text CHECK (label IS NULL OR char_length(label) <= 200),
  note text CHECK (note IS NULL OR char_length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((start_line IS NULL) = (end_line IS NULL)),
  CHECK (start_line IS NULL OR (start_line >= 1 AND end_line >= start_line)),
  FOREIGN KEY (repository_id, user_id) REFERENCES repositories (id, owner_id)
    ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE UNIQUE INDEX bookmarks_anchor ON bookmarks
  (user_id, repository_id, md5(path), md5(COALESCE(symbol_key, '')), COALESCE(start_line, 0), COALESCE(end_line, 0));
CREATE INDEX bookmarks_repository_user ON bookmarks (repository_id, user_id);

-- ---------------------------------------------------------------- learner position

-- Where the learner is, kept separately for guided learning and free exploration so exploring never moves the
-- learning position. Anchored by code identity (path, stable key, lines, commit), never by a disposable row id.
-- `state` holds versioned client state for the workspace (P2.1).
CREATE TABLE learner_positions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id uuid NOT NULL,
  track text NOT NULL CHECK (track IN ('learning', 'exploration')),
  path text CHECK (path IS NULL OR char_length(path) BETWEEN 1 AND 1024),
  symbol_key text CHECK (symbol_key IS NULL OR char_length(symbol_key) BETWEEN 1 AND 4096),
  start_line int,
  end_line int,
  commit_sha text CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{40}$'),
  state jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(state) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, repository_id, track),
  CHECK ((start_line IS NULL) = (end_line IS NULL)),
  CHECK (start_line IS NULL OR (start_line >= 1 AND end_line >= start_line)),
  FOREIGN KEY (repository_id, user_id) REFERENCES repositories (id, owner_id)
    ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX learner_positions_repository_user ON learner_positions (repository_id, user_id);
