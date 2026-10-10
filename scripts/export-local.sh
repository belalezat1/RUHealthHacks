#!/usr/bin/env bash
# Local synthetic database export; never destroys or removes the source volume.
set -euo pipefail
cd "$(dirname "$0")/.."
destination="${1:-exports/sevaro-$(date -u +%Y%m%dT%H%M%SZ).dump}"
mkdir -p "$(dirname "$destination")"
test ! -e "$destination" || { echo "Refusing to overwrite $destination" >&2; exit 2; }
temporary="$destination.partial"
trap 'rm -f "$temporary"' EXIT
docker compose exec -T db pg_dump -U sevaro -d sevaro --format=custom --no-owner --no-acl > "$temporary"
test -s "$temporary"
mv "$temporary" "$destination"
echo "Exported synthetic application database to $destination"
echo 'Keep the export outside temporary workshop resources. No credentials are exported by this script.'
