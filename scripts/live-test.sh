#!/usr/bin/env bash
#
# Run conduit's full test suite WITH the live-acceptance suites enabled, against a running credvault
# + Postgres. The offline `pnpm test` skips the live suites; this script supplies the three env gates
# (see packages/test-support) with local-dev defaults, all overridable from the environment.
#
#   ./scripts/live-test.sh                       # use the defaults below
#   CONDUIT_CREDVAULT_URL=http://host:8000 ./scripts/live-test.sh
#   CONDUIT_TENANT_KEY_FILE=/path/to/tenant_key.txt ./scripts/live-test.sh
#   CONDUIT_CREDVAULT_TENANT_KEY=cdv_... ./scripts/live-test.sh   # pass the key value directly
#
# Prereqs: a credvault stack is up (its `docker compose up -d` gives web :8000 + Postgres :5432) with
# the verify-acme tenant + alice/github connection.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Where credvault lives relative to this repo, for the default tenant-key path. Override with
# CONDUIT_TENANT_KEY_FILE (or CONDUIT_CREDVAULT_TENANT_KEY) if your layout differs.
CREDVAULT_DIR="${CREDVAULT_DIR:-$repo_root/../credvault}"

export CONDUIT_CREDVAULT_URL="${CONDUIT_CREDVAULT_URL:-http://localhost:8000}"
export CONDUIT_TEST_DATABASE_URL="${CONDUIT_TEST_DATABASE_URL:-postgres://vault:vault@localhost:5432/vault}"
if [[ -z "${CONDUIT_CREDVAULT_TENANT_KEY:-}" ]]; then
  export CONDUIT_TENANT_KEY_FILE="${CONDUIT_TENANT_KEY_FILE:-$CREDVAULT_DIR/secrets/tenant_key.txt}"
fi

if [[ -z "${CONDUIT_CREDVAULT_TENANT_KEY:-}" && ! -f "${CONDUIT_TENANT_KEY_FILE:-}" ]]; then
  echo "error: no credvault tenant key found." >&2
  echo "  set CONDUIT_CREDVAULT_TENANT_KEY=<key>, or CONDUIT_TENANT_KEY_FILE=<path>," >&2
  echo "  or place credvault at $CREDVAULT_DIR (its secrets/tenant_key.txt is read by default)." >&2
  exit 1
fi

echo "live test → credvault=$CONDUIT_CREDVAULT_URL  db=$CONDUIT_TEST_DATABASE_URL  key=${CONDUIT_CREDVAULT_TENANT_KEY:+<inline>}${CONDUIT_TENANT_KEY_FILE:-}"
cd "$repo_root"
exec pnpm test "$@"
