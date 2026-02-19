#!/usr/bin/env bash
set -euo pipefail

# Enforce deterministic lockfile gates for sync/release branches.
# Gate 1: package.json change requires pnpm-lock.yaml change.
# Gate 2: pnpm install --frozen-lockfile must succeed.

if [[ "${1-}" == "--help" ]]; then
  cat <<'USAGE'
Usage: scripts/ikentic/check-lockfile-gates.sh [<base-ref> [<head-ref>]]

Defaults:
  base-ref = origin/integration/ikentic
  head-ref = HEAD
USAGE
  exit 0
fi

base_ref="${1:-origin/integration/ikentic}"
head_ref="${2:-HEAD}"

diff_files="$(git diff --name-only "${base_ref}...${head_ref}")"

pkg_changed=0
lock_changed=0

if printf '%s\n' "$diff_files" | rg -q '(^|/)package\.json$'; then
  pkg_changed=1
fi
if printf '%s\n' "$diff_files" | rg -q '^pnpm-lock\.yaml$'; then
  lock_changed=1
fi

if [[ "$pkg_changed" -eq 1 && "$lock_changed" -eq 0 ]]; then
  echo "lockfile gate failed: package manifests changed but pnpm-lock.yaml did not" >&2
  echo "base/head: ${base_ref}...${head_ref}" >&2
  exit 1
fi

if command -v direnv >/dev/null 2>&1; then
  direnv exec . pnpm install --frozen-lockfile
else
  pnpm install --frozen-lockfile
fi

echo "lockfile gates passed"
