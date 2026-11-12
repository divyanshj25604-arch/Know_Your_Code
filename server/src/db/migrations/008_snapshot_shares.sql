-- P1.5: revocable share links. Rollback: server/src/db/rollbacks/008_snapshot_shares.down.sql
-- Share tokens are signed and stateless; revoking them sets this timestamp, and every token for the snapshot issued
-- before it stops working.
ALTER TABLE snapshots ADD COLUMN shares_revoked_at timestamptz;
