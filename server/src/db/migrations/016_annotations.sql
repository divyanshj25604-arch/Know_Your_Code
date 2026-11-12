-- Annotations: a learner's own note on a graph entity (a module, file, symbol, file relationship or flow step).
-- Distinct from bookmarks (a saved place): several notes may sit on one target. A learning row like bookmarks: it
-- hangs off the durable repository row through the composite (repository_id, user_id) key, so it survives code
-- retention, moves with a claimed repository (ON UPDATE CASCADE, deferrable for the claim transaction) and is deleted
-- with the repository. `target_key` is stable across re-analysis (module key, path, symbol key, `from|kind|to`,
-- `METHOD route#index`); `path`, lines and commit anchor the note in code when it has a code location.
-- Rollback: server/src/db/rollbacks/016_annotations.down.sql
CREATE TABLE annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id uuid NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('module', 'file', 'symbol', 'relation', 'flow_step')),
  target_key text NOT NULL CHECK (char_length(target_key) BETWEEN 1 AND 4096),
  target_label text NOT NULL CHECK (char_length(target_label) BETWEEN 1 AND 300),
  path text CHECK (path IS NULL OR char_length(path) BETWEEN 1 AND 1024),
  start_line int,
  end_line int,
  commit_sha text CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{40}$'),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((start_line IS NULL) = (end_line IS NULL)),
  CHECK (start_line IS NULL OR (start_line >= 1 AND end_line >= start_line)),
  FOREIGN KEY (repository_id, user_id) REFERENCES repositories (id, owner_id)
    ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX annotations_repository_user ON annotations (repository_id, user_id);
CREATE INDEX annotations_user ON annotations (user_id);
