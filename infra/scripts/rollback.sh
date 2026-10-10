#!/usr/bin/env bash
# Roll back to a previous release SHA. Runs ON THE HOST as root.
#   bash /opt/sevaro/repo/infra/scripts/rollback.sh <previous sha>
# Schema-aware: an older release refuses to open a database migrated by a newer one, so if the
# old API will not become healthy we restore the pre-release backup into place first.
set -euo pipefail
PREV="${1:?usage: rollback.sh <sha>}"
REPO=/opt/sevaro/repo
STATE=/srv/sevaro/state
cd "$REPO"
git checkout --quiet --detach "$PREV"
sed -i "s/^RELEASE_SHA=.*/RELEASE_SHA=$PREV/" .env
COMPOSE=(docker compose -f compose.yaml -f infra/aws/compose.aws.yaml)

if docker image inspect "sevaro-api:$PREV" >/dev/null 2>&1; then
  echo "reusing existing images for $PREV"
else
  "${COMPOSE[@]}" build
fi

if "${COMPOSE[@]}" up -d --wait --wait-timeout 120; then
  echo "$PREV" > /srv/sevaro/current_sha
  echo "$(date -u +%FT%TZ) ROLLBACK $PREV" >> /srv/sevaro/releases.log
  echo "ROLLED BACK to $PREV (database kept)"
  exit 0
fi

BACKUP=$(cat /srv/sevaro/last_backup 2>/dev/null || true)
[ -n "$BACKUP" ] && [ -f "$BACKUP" ] || { echo "no pre-release backup available" >&2; exit 1; }
echo "previous release could not open the current database; restoring $BACKUP" >&2
"${COMPOSE[@]}" stop api
mv "$STATE/sevaro.sqlite3" "$STATE/sevaro.sqlite3.rolled-back.$(date -u +%s)"
rm -f "$STATE/sevaro.sqlite3-wal" "$STATE/sevaro.sqlite3-shm"
cp "$BACKUP" "$STATE/sevaro.sqlite3"
chown 10001:10001 "$STATE/sevaro.sqlite3"
"${COMPOSE[@]}" up -d --wait --wait-timeout 120
echo "$PREV" > /srv/sevaro/current_sha
echo "$(date -u +%FT%TZ) ROLLBACK+RESTORE $PREV from $BACKUP" >> /srv/sevaro/releases.log
echo "ROLLED BACK to $PREV with database restored from $BACKUP"
