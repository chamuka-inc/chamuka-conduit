#!/usr/bin/env bash
#
# Re-sync the vendored credvault OpenAPI spec from a local credvault checkout.
#
# conduit pins a snapshot of credvault's published OpenAPI as the source of truth for the one
# boundary it depends on (GET /v1/credentials/{provider}). The conformance test
# (packages/credvault-client/test/openapi-conformance.test.ts) fails if conduit's contract/mapping
# drifts from this snapshot — so after re-syncing, run the tests to see what credvault changed.
#
#   ./scripts/sync-credvault-openapi.sh                  # reads ../credvault/docs/openapi.yaml
#   CREDVAULT_DIR=/path/to/credvault ./scripts/sync-credvault-openapi.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CREDVAULT_DIR="${CREDVAULT_DIR:-$repo_root/../credvault}"
src="$CREDVAULT_DIR/docs/openapi.yaml"
dest="$repo_root/packages/credvault-client/credvault.openapi.yaml"

if [[ ! -f "$src" ]]; then
  echo "error: credvault OpenAPI spec not found at $src" >&2
  echo "  point CREDVAULT_DIR at a credvault checkout, e.g. CREDVAULT_DIR=/path/to/credvault $0" >&2
  exit 1
fi

cp "$src" "$dest"
echo "synced credvault OpenAPI ($(grep -m1 'version:' "$src" | tr -d ' ')) → ${dest#"$repo_root"/}"
echo "next: pnpm --filter @conduit/credvault-client test   # confirm conduit still conforms"
