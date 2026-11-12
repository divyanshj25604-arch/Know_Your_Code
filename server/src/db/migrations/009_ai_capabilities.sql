-- P2.3: answers record which capability (and which version of its prompt and schema) produced them, and the
-- evidence-carrying claims the verifier accepted. Rollback: server/src/db/rollbacks/009_ai_capabilities.down.sql
ALTER TABLE explanations
  ADD COLUMN capability text,
  ADD COLUMN capability_version text,
  ADD COLUMN claims jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(claims) = 'array');
ALTER TABLE messages
  ADD COLUMN capability text,
  ADD COLUMN capability_version text,
  ADD COLUMN claims jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(claims) = 'array');
-- Earlier answers came from the pre-registry flows.
UPDATE explanations SET capability = 'explain_selection', capability_version = 'legacy';
UPDATE messages SET capability = CASE intent WHEN 'concept' THEN 'teach_concept' ELSE 'follow_up' END,
                    capability_version = 'legacy'
  WHERE role = 'assistant';
