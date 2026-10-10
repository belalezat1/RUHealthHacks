#!/usr/bin/env bash
# Restore only into a new, isolated database; never replace the active demo database.
set -euo pipefail
cd "$(dirname "$0")/.."
dump="${1:?Usage: restore-local.sh exports/file.dump new_database_name}"
database="${2:?Provide a new isolated database name}"
[[ "$database" =~ ^sevaro_restore_[a-z0-9_]+$ ]] || { echo 'New database name must begin sevaro_restore_ and contain lowercase letters, digits, or underscores.' >&2; exit 2; }
test -s "$dump"
docker compose exec -T db createdb -U sevaro "$database"
docker compose exec -T db pg_restore -U sevaro -d "$database" --no-owner --no-acl --exit-on-error < "$dump"
echo "Restored to isolated database $database. The active database and volume are unchanged."
