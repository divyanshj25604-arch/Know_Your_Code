-- Schema from docs/10 §4, with the deviations recorded in docs/implementation/00_Execution_Plan.md:
--  * snapshots.commit_sha is nullable (anonymous GitHub fallback cannot resolve a SHA); content_hash added.
--  * snapshots.error_message holds a sanitised, user-safe message for failed imports.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  gh_owner text NOT NULL,
  gh_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, gh_owner, gh_name)
);

CREATE TABLE snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  ref text,
  commit_sha text,
  content_hash text,
  status text NOT NULL CHECK (status IN ('queued','fetching','filtering','analysing','summarising','ready','ready_partial','failed','expired')),
  stages jsonb NOT NULL DEFAULT '[]',
  overview jsonb,
  skipped jsonb NOT NULL DEFAULT '[]',
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX snapshots_repo_sha ON snapshots (repository_id, commit_sha) WHERE commit_sha IS NOT NULL;

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  path text NOT NULL,
  language text,
  analysable boolean NOT NULL,
  generated boolean NOT NULL DEFAULT false,
  size_bytes int NOT NULL,
  line_count int NOT NULL,
  content text NOT NULL,
  UNIQUE (snapshot_id, path)
);
CREATE INDEX files_content_trgm ON files USING gin (content gin_trgm_ops);

CREATE TABLE symbols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  parent_symbol_id uuid REFERENCES symbols(id) ON DELETE CASCADE,
  name text NOT NULL,
  qualified_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('function','method','class','variable','parameter','import','export')),
  tags text[] NOT NULL DEFAULT '{}',
  exported boolean NOT NULL DEFAULT false,
  signature text,
  start_line int NOT NULL, start_col int NOT NULL, end_line int NOT NULL, end_col int NOT NULL
);
CREATE INDEX symbols_pos ON symbols (snapshot_id, file_id, start_line, end_line);
CREATE INDEX symbols_name ON symbols (snapshot_id, name);

CREATE TABLE edges (
  id bigserial PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('imports','calls','route_handler')),
  source_symbol_id uuid REFERENCES symbols(id) ON DELETE CASCADE,
  source_file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  target_symbol_id uuid REFERENCES symbols(id) ON DELETE CASCADE,
  target_file_id uuid REFERENCES files(id) ON DELETE CASCADE,
  target_external text,
  line int NOT NULL,
  provenance text NOT NULL CHECK (provenance IN ('verified','pattern')),
  reason text,
  meta jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX edges_src ON edges (snapshot_id, source_symbol_id);
CREATE INDEX edges_tgt ON edges (snapshot_id, target_symbol_id);
CREATE INDEX edges_file ON edges (snapshot_id, source_file_id);

CREATE TABLE explanations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES explanations(id) ON DELETE SET NULL,
  cache_key char(64) NOT NULL,
  selection jsonb NOT NULL,
  kind text NOT NULL,
  depth text NOT NULL,
  symbol_id uuid REFERENCES symbols(id) ON DELETE SET NULL,
  body jsonb NOT NULL,
  prompt_version text NOT NULL,
  model text NOT NULL,
  refs_stripped int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX explanations_cache ON explanations (snapshot_id, cache_key);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  explanation_id uuid NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  intent text NOT NULL CHECK (intent IN ('followup','concept')),
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_expl ON messages (explanation_id, created_at);

CREATE TABLE check_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  explanation_id uuid NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  question jsonb NOT NULL,
  answer jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  rating text NOT NULL CHECK (rating IN ('up','down')),
  reason text,
  comment text CHECK (char_length(comment) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, target_type, target_id)
);

CREATE TABLE events (
  id bigserial PRIMARY KEY,
  owner_id uuid REFERENCES owners(id) ON DELETE SET NULL,
  name text NOT NULL,
  props jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_name_time ON events (name, created_at);

CREATE TABLE llm_calls (
  id bigserial PRIMARY KEY,
  owner_id uuid,
  snapshot_id uuid,
  task text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10,6),
  first_token_ms int,
  total_ms int,
  status text NOT NULL,
  cache_hit boolean NOT NULL DEFAULT false,
  refs_stripped int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_calls_day ON llm_calls (created_at);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('queued','running','done','failed')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_state ON jobs (state);

CREATE TABLE deletion_log (
  id bigserial PRIMARY KEY,
  repository_ref text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('user','retention')),
  deleted_at timestamptz NOT NULL DEFAULT now()
);
