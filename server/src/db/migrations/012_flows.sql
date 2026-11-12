-- P3.2: request flows discovered per analysis run (Express routes through middleware, handler and verified calls).
-- Rollback: server/src/db/rollbacks/012_flows.down.sql
CREATE TABLE flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  analysis_run_id uuid NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  flow_key text NOT NULL,
  method text NOT NULL,
  route_path text,
  name text NOT NULL,
  client_count int NOT NULL DEFAULT 0 CHECK (client_count >= 0),
  UNIQUE (analysis_run_id, flow_key)
);
CREATE INDEX flows_snapshot ON flows (snapshot_id);
CREATE TABLE flow_steps (
  flow_id uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  position int NOT NULL CHECK (position >= 0),
  kind text NOT NULL CHECK (kind IN ('client', 'route', 'middleware', 'handler', 'call', 'response', 'unknown')),
  label text NOT NULL,
  file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  line int CHECK (line IS NULL OR line > 0),
  symbol_id uuid REFERENCES symbols(id) ON DELETE SET NULL,
  symbol_key text,
  provenance text NOT NULL CHECK (provenance IN ('verified', 'pattern', 'unknown')),
  depth int NOT NULL DEFAULT 0 CHECK (depth >= 0),
  reason text,
  -- A verified step stands for one stored call edge; it goes with that edge.
  edge_id bigint REFERENCES edges(id) ON DELETE CASCADE,
  PRIMARY KEY (flow_id, position),
  CHECK (provenance <> 'verified' OR edge_id IS NOT NULL),
  CHECK (kind <> 'unknown' OR (provenance = 'unknown' AND reason IS NOT NULL))
);
CREATE INDEX flow_steps_symbol ON flow_steps (symbol_id);
CREATE INDEX flow_steps_edge ON flow_steps (edge_id);
-- Null: the run predates flow discovery (re-import to get flows); 0: analysed, no routes found.
ALTER TABLE analysis_runs ADD COLUMN flow_count int CHECK (flow_count IS NULL OR flow_count >= 0);
