-- Reverts 005_users_and_sessions.sql.
-- LOSSY for data created after the migration: registered accounts would lose their email and password and become
-- anonymous rows again, and every session would be deleted. The script therefore refuses to run while registered
-- accounts exist. To proceed anyway, first run:  UPDATE users SET kind='anonymous', email=NULL,
-- password_hash=NULL, registered_at=NULL;   (a deliberate, irreversible operator decision).
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE kind = 'registered') THEN
    RAISE EXCEPTION 'registered accounts exist; rolling back 005 would delete their credentials (see header)';
  END IF;
END $$;
DROP TABLE user_sessions;
DROP INDEX IF EXISTS users_anonymous_idle;
DROP INDEX IF EXISTS users_email;
ALTER TABLE users
  DROP CONSTRAINT users_email_normalised,
  DROP CONSTRAINT users_credentials_by_kind,
  DROP COLUMN registered_at,
  DROP COLUMN password_hash,
  DROP COLUMN email,
  DROP COLUMN kind;
ALTER INDEX users_pkey RENAME TO owners_pkey;
ALTER TABLE users RENAME TO owners;
DELETE FROM schema_migrations WHERE name = '005_users_and_sessions.sql';
COMMIT;
