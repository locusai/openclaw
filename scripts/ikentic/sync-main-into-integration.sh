#!/usr/bin/env bash
set -euo pipefail

# Deterministic mechanical sync: upstream/main -> main (ff-only) -> integration topic branch.
#
# This script intentionally does NOT run Ikentic package/plugin sync. That work is review-lane
# and should land as "our changes" after the mechanical sync is folded into integration.

usage() {
  cat <<'USAGE'
Usage: scripts/ikentic/sync-main-into-integration.sh

Creates a new sync branch from origin/integration/ikentic, merges origin/main into it,
applies deterministic conflict resolution for classes A/B/C, and runs lockfile gates.

Exit codes:
  0: success, sync branch created and merge commit written
  2: Class D conflicts remain and require review-lane manual resolution
USAGE
}

if [[ "${1-}" == "--help" ]]; then
  usage
  exit 0
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

run_cmd() {
  if command -v direnv >/dev/null 2>&1; then
    direnv exec . "$@"
  else
    "$@"
  fi
}

# Stage helper scripts to a stable tmp dir so branch switches (main/integration) don't remove them.
tools_dir="$(mktemp -d /tmp/ikentic-sync-tools-XXXXXX)"
cleanup_tools() {
  rm -rf "$tools_dir"
}
trap cleanup_tools EXIT

stage_tool() {
  local f="$1"
  cp "${script_dir}/${f}" "${tools_dir}/${f}"
  chmod +x "${tools_dir}/${f}"
}

stage_tool "classify-conflicts.sh"
stage_tool "resolve-sync-conflicts.sh"
stage_tool "check-lockfile-gates.sh"
stage_tool "snapshot-pr-refs.sh"
stage_tool "refresh-pr-refs-with-main.sh"
stage_tool "port-pr-refs.sh"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "working tree is dirty; commit/stash before sync" >&2
  git status --porcelain >&2 || true
  exit 1
fi

git fetch origin --prune
git fetch upstream --prune

# Ensure local main exists and mirror upstream/main with ff-only policy.
if git show-ref --verify --quiet refs/heads/main; then
  git switch main
else
  git switch -c main origin/main
fi

git merge --ff-only upstream/main
git push origin main

# Snapshot + refresh origin/pr/* branches against updated main so they stay current.
# If a branch has rebase conflicts, it is left unchanged and recorded as NEEDS_MANUAL.
pre_refresh_snap_out="$("${tools_dir}/snapshot-pr-refs.sh")"
pre_refresh_snap_path="$(echo "$pre_refresh_snap_out" | awk '{print $2}')"
"${tools_dir}/refresh-pr-refs-with-main.sh" --snapshot "$pre_refresh_snap_path" || true

# Re-snapshot after refresh for deterministic porting (STALE_SNAPSHOT blocks stack updates).
post_refresh_snap_out="$("${tools_dir}/snapshot-pr-refs.sh")"
post_refresh_snap_path="$(echo "$post_refresh_snap_out" | awk '{print $2}')"

stamp="$(date +%Y%m%d-%H%M%S)"
branch="codex/sync-main-${stamp}"

git switch -c "$branch" origin/integration/ikentic

# Merge origin/main with a merge commit; stop before commit so we can run deterministic resolution.
git -c rerere.enabled=false -c rerere.autoupdate=false merge --no-ff --no-commit origin/main || true

if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
  "${tools_dir}/resolve-sync-conflicts.sh" || status=$?
  status="${status:-0}"
  if [[ "$status" -eq 2 ]]; then
    echo >&2
    echo "Class D conflicts remain; move these into the review lane." >&2
    "${tools_dir}/classify-conflicts.sh" >&2 || true
    exit 2
  fi
  if [[ "$status" -ne 0 ]]; then
    exit "$status"
  fi
fi

# Finalize the merge commit (mechanical lane marker subject).
git commit -m "sync integration with mirror main"

# Attempt clean ports of origin/pr/* commits (no manual conflict edits).
# If any PR commit conflicts, stop and move the remainder to review lane by design.
tmp_root="${TMPDIR:-/tmp}"
port_report="${tmp_root%/}/ikentic-reports/pr-port-integration-${stamp}.tsv"
"${tools_dir}/port-pr-refs.sh" \
  --base origin/main \
  --snapshot "$post_refresh_snap_path" \
  --report "$port_report"

if rg -q $'\tSTALE_SNAPSHOT\t' "$port_report"; then
  echo "blocking: snapshot drift detected during PR port (see report)" >&2
  echo "pr port report: ${port_report}" >&2
  exit 2
fi
if rg -q $'\tNEEDS_REVIEW\t' "$port_report"; then
  echo "review lane required: some PR commits did not apply cleanly (see report)" >&2
  echo "pr port report: ${port_report}" >&2
  exit 2
fi

# Lockfile gates: dependency-aware manifest/lock coupling + frozen install.
"${tools_dir}/check-lockfile-gates.sh" origin/integration/ikentic HEAD

# Build gates: catch semantic drops from auto-merge (type contracts, lint, format).
run_cmd pnpm check
run_cmd pnpm build

echo "created sync branch: ${branch}"
