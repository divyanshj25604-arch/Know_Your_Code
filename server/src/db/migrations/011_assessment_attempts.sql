-- P3.5: every answer to a check is kept (attempt history), with its verdict and score.
-- Rollback: server/src/db/rollbacks/011_assessment_attempts.down.sql
CREATE TABLE assessment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_attempt_id uuid NOT NULL REFERENCES check_attempts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer jsonb NOT NULL CHECK (jsonb_typeof(answer) = 'object'),
  verdict text NOT NULL CHECK (verdict IN ('correct', 'partly', 'incorrect')),
  score numeric(4,3) NOT NULL CHECK (score >= 0 AND score <= 1),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assessment_attempts_check ON assessment_attempts (check_attempt_id, created_at);
CREATE INDEX assessment_attempts_user ON assessment_attempts (user_id, created_at);
-- The question's format (choice or open), stored with the question.
ALTER TABLE check_attempts ADD COLUMN format text NOT NULL DEFAULT 'choice' CHECK (format IN ('choice', 'open'));
-- Answers given before attempt history existed become each check's first attempt.
INSERT INTO assessment_attempts (check_attempt_id, user_id, answer, verdict, score, result, created_at)
SELECT c.id, e.owner_id, c.answer,
       CASE WHEN (c.result->>'correct')::boolean THEN 'correct' ELSE 'incorrect' END,
       CASE WHEN (c.result->>'correct')::boolean THEN 1 ELSE 0 END,
       c.result, c.created_at
FROM check_attempts c JOIN explanations e ON e.id = c.explanation_id
WHERE c.answer IS NOT NULL AND c.result IS NOT NULL AND jsonb_typeof(c.answer) = 'object';
