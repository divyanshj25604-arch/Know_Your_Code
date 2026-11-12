#!/usr/bin/env bash
# Restore a logical backup into an EMPTY database (P4.2). Never restores over a database that has tables.
#
#   TARGET_DATABASE_URL=postgres://.../kyc_restore scripts/db-restore.sh backups/kyc-20261112T000000Z.dump
#
# Then point a staging copy of the app at the restored database, run `npm run db:migrate` (applies any migrations
# newer than the backup) and `npm run smoke`, and only then switch production to it. See
# project-docs/13_Phase_4_2_Completion_Report.md, "Restore procedure".
set -euo pipefail

: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL must be set to an empty database (it is never printed)}"
dump="${1:?usage: db-restore.sh <backup.dump>}"
[ -f "$dump" ] || { echo "no such file: $dump" >&2; exit 2; }
pg_restore --list "$dump" >/dev/null

existing="$(psql "$TARGET_DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
if [ "$existing" != "0" ]; then
  echo "refusing to restore: the target database already has $existing tables (restore into an empty database)" >&2
  exit 3
fi

pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname="$TARGET_DATABASE_URL" "$dump"
psql "$TARGET_DATABASE_URL" -Atc "SELECT 'restored: ' || count(*) || ' migrations, latest ' || max(name) FROM schema_migrations"
