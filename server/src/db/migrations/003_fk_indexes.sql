-- Indexes on foreign-key columns. Without them, deleting a snapshot (user request or 7-day retention) made Postgres
-- scan `edges` once per deleted symbol (the composite (snapshot_id, ...) indexes cannot serve a lookup by the
-- referencing column alone). Measured on a 5.9k-symbol / 10k-edge repo: delete took ~12 s before this migration.
CREATE INDEX IF NOT EXISTS edges_source_symbol ON edges (source_symbol_id);
CREATE INDEX IF NOT EXISTS edges_target_symbol ON edges (target_symbol_id);
CREATE INDEX IF NOT EXISTS edges_source_file ON edges (source_file_id);
CREATE INDEX IF NOT EXISTS edges_target_file ON edges (target_file_id);
CREATE INDEX IF NOT EXISTS symbols_parent ON symbols (parent_symbol_id);
CREATE INDEX IF NOT EXISTS symbols_file ON symbols (file_id);
CREATE INDEX IF NOT EXISTS explanations_symbol ON explanations (symbol_id);
CREATE INDEX IF NOT EXISTS explanations_owner ON explanations (owner_id);
CREATE INDEX IF NOT EXISTS explanations_parent ON explanations (parent_id);
CREATE INDEX IF NOT EXISTS check_attempts_expl ON check_attempts (explanation_id);
CREATE INDEX IF NOT EXISTS jobs_snapshot ON jobs (snapshot_id);
CREATE INDEX IF NOT EXISTS feedback_owner ON feedback (owner_id);
CREATE INDEX IF NOT EXISTS snapshots_repo ON snapshots (repository_id);
CREATE INDEX IF NOT EXISTS snapshots_expires ON snapshots (expires_at);
CREATE INDEX IF NOT EXISTS repositories_owner ON repositories (owner_id);
