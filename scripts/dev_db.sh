#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v pg_ctl >/dev/null || { echo 'Install PostgreSQL and put its bin directory on PATH.' >&2; exit 1; }
mkdir -p .local
if [[ ! -f .local/pgdata/PG_VERSION ]]; then
  initdb -D .local/pgdata --auth-local=trust --auth-host=trust --no-locale -E UTF8
fi
if ! pg_ctl -D .local/pgdata status >/dev/null 2>&1; then
  pg_ctl -D .local/pgdata -l .local/postgres.log -o '-p 55433 -h 127.0.0.1 -k /tmp' start
fi
if ! psql -h 127.0.0.1 -p 55433 -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='sevaro'" | rg -q '^1$'; then
  createdb -h 127.0.0.1 -p 55433 sevaro
fi
echo 'Local development database ready on 127.0.0.1:55433. Trust authentication is local development only.'
