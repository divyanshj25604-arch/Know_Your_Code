-- P4.3: AI budget controls. Every model call first reserves its worst-case cost under one advisory lock, so
-- concurrent requests cannot overspend the global daily cap, a per-user daily cap or a per-user daily request limit.
-- The reservation is released when the call is logged in llm_calls with its actual tokens and cost.
-- Rollback: server/src/db/rollbacks/014_ai_budget.down.sql
CREATE TABLE ai_reservations (
  id bigserial PRIMARY KEY,
  -- No foreign key: a reservation lives for seconds, and must not block deleting a user.
  user_id uuid,
  capability text NOT NULL,
  reserved_usd numeric(10,6) NOT NULL CHECK (reserved_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A crashed request's reservation stops counting after this time and is deleted by retention.
  expires_at timestamptz NOT NULL
);
CREATE INDEX ai_reservations_user ON ai_reservations (user_id, expires_at);
-- Usage per capability (the task column names the prompt kind, not the capability).
ALTER TABLE llm_calls ADD COLUMN capability text;
-- Why the model stopped (end_turn, max_tokens, refusal...): truncation becomes measurable per capability.
ALTER TABLE llm_calls ADD COLUMN stop_reason text;
-- Per-user daily spend and request counts.
CREATE INDEX llm_calls_owner_day ON llm_calls (owner_id, created_at);
