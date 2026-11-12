-- P3.1: modules and module-to-file membership per analysis run, for the architecture map.
-- Rollback: server/src/db/rollbacks/010_architecture.down.sql
CREATE TABLE modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  analysis_run_id uuid NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('package', 'directory')),
  root_path text NOT NULL,
  UNIQUE (analysis_run_id, module_key)
);
CREATE INDEX modules_snapshot ON modules (snapshot_id);
CREATE TABLE module_files (
  module_id uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  PRIMARY KEY (module_id, file_id)
);
CREATE INDEX module_files_file ON module_files (file_id);
CREATE TABLE module_dependencies (
  from_module uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  to_module uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  import_count int NOT NULL CHECK (import_count > 0),
  PRIMARY KEY (from_module, to_module),
  CHECK (from_module <> to_module)
);
CREATE INDEX module_dependencies_to ON module_dependencies (to_module);
ALTER TABLE analysis_runs ADD COLUMN monorepo boolean;
