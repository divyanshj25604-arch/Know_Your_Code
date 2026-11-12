-- P1.2: durable user identity. Rollback: server/src/db/rollbacks/005_users_and_sessions.down.sql
--
-- The anonymous `owners` table becomes `users`. A RENAME keeps every row, id and foreign key (repositories,
-- explanations, feedback and events all follow automatically), so every existing owner keeps access to everything
-- they imported: each becomes an anonymous user that can later be upgraded in place or claimed into an account.
-- Column names such as repositories.owner_id are kept; they now hold a users.id.
ALTER TABLE owners RENAME TO users;
ALTER INDEX owners_pkey RENAME TO users_pkey;

ALTER TABLE users
  ADD COLUMN kind text NOT NULL DEFAULT 'anonymous' CHECK (kind IN ('anonymous', 'registered')),
  ADD COLUMN email text,
  ADD COLUMN password_hash text,
  ADD COLUMN registered_at timestamptz,
  -- An anonymous user has no credentials; a registered one has all of them.
  ADD CONSTRAINT users_credentials_by_kind CHECK (
    (kind = 'anonymous' AND email IS NULL AND password_hash IS NULL AND registered_at IS NULL)
    OR (kind = 'registered' AND email IS NOT NULL AND password_hash IS NOT NULL AND registered_at IS NOT NULL)
  ),
  -- Emails are stored normalised so the unique index below is case-insensitive in effect.
  ADD CONSTRAINT users_email_normalised CHECK (email IS NULL OR email = lower(btrim(email)));
CREATE UNIQUE INDEX users_email ON users (email) WHERE email IS NOT NULL;
-- Retention looks for idle anonymous users only.
CREATE INDEX users_anonymous_idle ON users (last_seen_at) WHERE kind = 'anonymous';

-- Sign-in sessions. Only a SHA-256 hash of each opaque token is stored, so a database leak does not yield usable
-- credentials. Revocation is a timestamp (kept for audit until retention trims it), expiry is absolute.
CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  transport text NOT NULL CHECK (transport IN ('cookie', 'bearer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX user_sessions_user ON user_sessions (user_id);
CREATE INDEX user_sessions_expires ON user_sessions (expires_at);
