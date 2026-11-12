-- ZIP uploads: a repository can come from GitHub or from an uploaded archive. Uploaded repositories keep
-- gh_owner = '' (no GitHub owner can be empty, so they never collide with GitHub rows under
-- UNIQUE (owner_id, gh_owner, gh_name)) and gh_name = the project name taken from the archive's file name.
-- Rollback: server/src/db/rollbacks/015_uploads.down.sql
ALTER TABLE repositories ADD COLUMN source text NOT NULL DEFAULT 'github'
  CHECK (source IN ('github', 'upload'));

-- The uploaded archive, held only until the import job consumes it. The worker may run in another process, so the
-- bytes live here rather than in memory; a crashed run that is recovered finds them again.
CREATE TABLE snapshot_uploads (
  snapshot_id uuid PRIMARY KEY REFERENCES snapshots (id) ON DELETE CASCADE,
  archive bytea NOT NULL,
  file_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The archive is deleted as soon as its snapshot reaches a terminal state, whichever code path gets it there
-- (the import job, a failure record, or the runner giving up on an interrupted job).
CREATE FUNCTION snapshot_uploads_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM snapshot_uploads WHERE snapshot_id = NEW.id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER snapshots_release_upload
  AFTER UPDATE OF status ON snapshots
  FOR EACH ROW WHEN (NEW.status IN ('ready', 'ready_partial', 'failed'))
  EXECUTE FUNCTION snapshot_uploads_release();
