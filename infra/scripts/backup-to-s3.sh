#!/usr/bin/env bash
# On-demand consistent backup to the versioned S3 bucket. Runs ON THE HOST as root.
set -euo pipefail
cd /opt/sevaro/repo
BUCKET=$(cat /opt/sevaro/backup-bucket)
OUT="/srv/sevaro/backups/manual-$(date -u +%Y%m%dT%H%M%SZ).sqlite3"
python3 scripts/backup.py --db /srv/sevaro/state/sevaro.sqlite3 --out "$OUT"
aws s3 cp --quiet "$OUT" "s3://$BUCKET/backups/$(basename "$OUT")"
aws s3 cp --quiet "$OUT.json" "s3://$BUCKET/backups/$(basename "$OUT").json"
echo "uploaded s3://$BUCKET/backups/$(basename "$OUT")"
# Restore drill into a separate temporary path in a throwaway container (never over live state).
docker compose -f compose.yaml -f infra/aws/compose.aws.yaml run --rm --no-deps   -v "$OUT:/tmp/drill.sqlite3:ro" api python scripts/restore_check.py /tmp/drill.sqlite3
