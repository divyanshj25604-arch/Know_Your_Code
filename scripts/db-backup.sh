#!/usr/bin/env bash
# Logical backup of the Know Your Code database (P4.2), in addition to the platform's continuous backups.
#
#   DATABASE_URL=postgres://... scripts/db-backup.sh [backup-dir]
#
# Writes <backup-dir>/kyc-<UTC timestamp>.dump (pg_dump custom format, compressed), checks it is a readable
# archive, then deletes dumps older than BACKUP_RETENTION_DAYS (default 14) in that directory.
# The connection string is read from the environment and never printed.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set (it is never printed)}"
dir="${1:-./backups}"
retention="${BACKUP_RETENTION_DAYS:-14}"
case "$retention" in '' | *[!0-9]*) echo "BACKUP_RETENTION_DAYS must be a whole number" >&2; exit 2 ;; esac

mkdir -p "$dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$dir/kyc-$stamp.dump"
tmp="$out.partial"

pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$tmp" "$DATABASE_URL"
# A dump that pg_restore cannot list is not a backup.
pg_restore --list "$tmp" >/dev/null
mv "$tmp" "$out"
tables="$(pg_restore --list "$out" | grep -c ' TABLE DATA ' || true)"
echo "backup written: $out ($(wc -c <"$out" | tr -d ' ') bytes, $tables tables)"

# Retention: only this script's own files, only in this directory.
find "$dir" -maxdepth 1 -type f -name 'kyc-*.dump' -mtime "+$retention" -print -delete | sed 's/^/expired: /'
