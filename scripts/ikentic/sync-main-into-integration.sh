#!/usr/bin/env bash
set -euo pipefail

# Deterministic mirror->integration sync bootstrap.
# 1) fetch origin/upstream
# 2) ff-only main <- upstream/main, push origin main
# 3) create topic/sync-main-<stamp> from origin/integration/ikentic
# 4) merge origin/main into topic branch
# 5) classify + auto-resolve A/B/C conflicts and report remaining D conflicts

if [[ "${1-}" == "--help" ]]; then
  cat <<'USAGE'
Usage: scripts/ikentic/sync-main-into-integration.sh

Runs from repo root and prints the created sync branch name.
If Class D conflicts remain after deterministic auto-resolution, exits 2.
USAGE
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

run_cmd() {
  if command -v direnv >/dev/null 2>&1; then
    direnv exec . "$@"
  else
    "$@"
  fi
}

if [[ -n "$(git status --porcelain)" ]]; then
  echo "working tree is not clean; commit/stash before running sync-main-into-integration" >&2
  exit 1
fi

run_cmd git fetch origin --prune
run_cmd git fetch upstream --prune

run_cmd git switch main
run_cmd git merge --ff-only upstream/main
run_cmd git push origin main

stamp="$(date +%Y%m%d-%H%M%S)"
branch="topic/sync-main-${stamp}"
run_cmd git switch -c "$branch" origin/integration/ikentic

if ! run_cmd git merge --no-ff origin/main -m "sync integration with mirror main"; then
  :
fi

"$repo_root/scripts/ikentic/classify-conflicts.sh" || true

if "$repo_root/scripts/ikentic/resolve-sync-conflicts.sh"; then
  echo "sync bootstrap complete: ${branch}"
  exit 0
fi

status=$?
if [[ "$status" -eq 2 ]]; then
  echo "sync bootstrap requires manual Class D resolution on ${branch}" >&2
  exit 2
fi

exit "$status"
