-- Reverts 014_ai_budget.sql. Loses in-flight reservations and the capability recorded on each model call.
BEGIN;
DROP INDEX IF EXISTS llm_calls_owner_day;
ALTER TABLE llm_calls DROP COLUMN stop_reason;
ALTER TABLE llm_calls DROP COLUMN capability;
DROP TABLE ai_reservations;
DELETE FROM schema_migrations WHERE name = '014_ai_budget.sql';
COMMIT;
