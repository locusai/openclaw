#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IKENTIC_DOCKERFILE="$ROOT_DIR/Dockerfile.ikentic"

if [[ ! -f "$IKENTIC_DOCKERFILE" ]]; then
  echo "Missing Dockerfile.ikentic: $IKENTIC_DOCKERFILE" >&2
  exit 1
fi

before="$(mktemp)"
after="$(mktemp)"
trap 'rm -f "$before" "$after"' EXIT

cp "$IKENTIC_DOCKERFILE" "$before"
bash "$ROOT_DIR/scripts/sync-ikentic-dockerfile.sh" >/dev/null
cp "$IKENTIC_DOCKERFILE" "$after"
cp "$before" "$IKENTIC_DOCKERFILE"

if ! diff -u "$before" "$after"; then
  echo ""
  echo "Dockerfile.ikentic is out of sync with Dockerfile." >&2
  echo "Run: bash scripts/sync-ikentic-dockerfile.sh" >&2
  exit 1
fi

echo "Dockerfile.ikentic is in sync"

