#!/usr/bin/env bash
# Deploy a git ref to the EC2 host. Runs ON THE HOST as root (via Session Manager / SSM).
#   bash /opt/sevaro/repo/infra/scripts/deploy.sh origin/yassin
# Steps: fetch ref -> consistent SQLite backup (local + S3) -> build SHA-tagged images
#        -> roll out -> health check reports the new SHA -> record release. On failure: roll back.
set -euo pipefail

REF="${1:?usage: deploy.sh <git ref, e.g. origin/yassin or a commit sha>}"
REPO=/opt/sevaro/repo
STATE=/srv/sevaro/state
BACKUPS=/srv/sevaro/backups
cd "$REPO"

TOKEN=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
export AWS_REGION=$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)
param() { aws ssm get-parameter --region "$AWS_REGION" --name "$1" --with-decryption --query Parameter.Value --output text; }

git fetch --all --prune --quiet
git checkout --quiet --detach "$REF"
SHA=$(git rev-parse HEAD)
PREV=$(cat /srv/sevaro/current_sha 2>/dev/null || echo "")
echo "deploying $SHA (previous: ${PREV:-none})"

# 1. Consistent backup before any change (uses SQLite's backup API; safe while running).
BUCKET=$(cat /opt/sevaro/backup-bucket)
if [ -f "$STATE/sevaro.sqlite3" ]; then
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  OUT="$BACKUPS/pre-${SHA:0:12}-$STAMP.sqlite3"
  python3 scripts/backup.py --db "$STATE/sevaro.sqlite3" --out "$OUT"
  aws s3 cp --quiet "$OUT" "s3://$BUCKET/backups/$(basename "$OUT")"
  aws s3 cp --quiet "$OUT.json" "s3://$BUCKET/backups/$(basename "$OUT").json"
  echo "$OUT" > /srv/sevaro/last_backup
fi

# 2. Server-side configuration (secrets never live in the repo or the images).
umask 077
cat > .env <<EOF
SEVARO_MODE=hosted
SEVARO_DEMO_PASSWORD=$(param /sevaro/demo-password)
SEVARO_ALLOWED_ORIGINS=$(param /sevaro/allowed-origin)
SEVARO_STATE_PATH=$STATE
RELEASE_SHA=$SHA
WEB_PORT=8080
AWS_REGION=$AWS_REGION
EOF

COMPOSE=(docker compose -f compose.yaml -f infra/aws/compose.aws.yaml)

# 3. Build immutable SHA-tagged images. Previous images stay on the host for rollback.
"${COMPOSE[@]}" build --pull

# 4. Roll out and wait for health checks.
if ! "${COMPOSE[@]}" up -d --wait --wait-timeout 180; then
  echo "rollout failed; rolling back" >&2
  [ -n "$PREV" ] && bash infra/scripts/rollback.sh "$PREV"
  exit 1
fi

# 5. Verify through the proxy that the NEW release is the one answering.
READY=$(curl -fsS http://127.0.0.1:8080/health/ready)
echo "$READY"
if ! grep -q "$SHA" <<<"$READY"; then
  echo "health check does not report $SHA; rolling back" >&2
  [ -n "$PREV" ] && bash infra/scripts/rollback.sh "$PREV"
  exit 1
fi

echo "$SHA" > /srv/sevaro/current_sha
echo "$(date -u +%FT%TZ) $SHA ${PREV:-none}" >> /srv/sevaro/releases.log
docker image prune -f --filter "until=72h" >/dev/null || true
echo "DEPLOYED $SHA"
