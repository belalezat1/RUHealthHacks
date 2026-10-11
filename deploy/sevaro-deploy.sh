#!/usr/bin/env bash
# Managed checkout only. Never run against a developer's working directory.
set -Eeuo pipefail
umask 027

DEPLOY_DIR="${SEVARO_DEPLOY_DIR:-/opt/sevaro}"
ENV_FILE="${SEVARO_ENV_FILE:-/etc/sevaro/backend.env}"
REPO="$DEPLOY_DIR/repo"
REMOTE="https://github.com/belalezat1/RUHealthHacks.git"
BRANCH="belal"
CONTAINER="sevaro"
PREVIOUS="sevaro-previous"
switched=0

mkdir -p "$DEPLOY_DIR"
exec 9>"$DEPLOY_DIR/deploy.lock"
flock -n 9 || exit 0
test -r "$ENV_FILE" || { echo "Missing $ENV_FILE; configure server environment first." >&2; exit 1; }

rollback() {
  local result=$?
  trap - ERR
  if (( switched )); then
    echo "Release failed readiness; restoring previous container." >&2
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    if docker container inspect "$PREVIOUS" >/dev/null 2>&1; then
      docker rename "$PREVIOUS" "$CONTAINER"
      docker start "$CONTAINER" >/dev/null
    fi
  fi
  exit "$result"
}
trap rollback ERR

if [[ ! -d "$REPO/.git" ]]; then
  git clone --single-branch --branch "$BRANCH" "$REMOTE" "$REPO"
fi
git -C "$REPO" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 fetch --quiet origin \
  "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
release=$(git -C "$REPO" rev-parse "refs/remotes/origin/$BRANCH")

if [[ "${1:-}" != "--force" && -f "$DEPLOY_DIR/current-release" ]] \
  && [[ "$(cat "$DEPLOY_DIR/current-release")" == "$release" ]]; then
  exit 0
fi

git -C "$REPO" -c advice.detachedHead=false checkout --quiet --detach --force "$release"
image="sevaro:$release"
echo "Building belal release $release"
docker build --build-arg "RELEASE_SHA=$release" -f "$REPO/backend/Dockerfile" -t "$image" "$REPO"

# Finish the build and migration before touching the currently serving container.
# Database migrations must be backward compatible with the previous release.
docker run --rm --env-file "$ENV_FILE" "$image" python -m backend.api.admin migrate

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  if docker container inspect "$PREVIOUS" >/dev/null 2>&1; then
    docker rm "$PREVIOUS" >/dev/null
  fi
  docker stop --time 20 "$CONTAINER" >/dev/null
  if ! docker rename "$CONTAINER" "$PREVIOUS"; then
    docker start "$CONTAINER" >/dev/null
    exit 1
  fi
fi
switched=1
docker run --detach --name "$CONTAINER" --restart unless-stopped \
  --env-file "$ENV_FILE" --publish 127.0.0.1:8000:8000 \
  --log-opt max-size=10m --log-opt max-file=3 "$image" >/dev/null

ready=0
deadline=$((SECONDS + 90))
while (( SECONDS < deadline )); do
  if curl --silent --fail --max-time 3 http://127.0.0.1:8000/health/ready >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
if (( ! ready )); then
  echo "New release did not become ready within 90 seconds." >&2
  false # ERR trap restores the previous container.
fi

printf '%s\n' "$release" > "$DEPLOY_DIR/current-release.tmp"
mv "$DEPLOY_DIR/current-release.tmp" "$DEPLOY_DIR/current-release"
switched=0
echo "Serving belal release $release"
