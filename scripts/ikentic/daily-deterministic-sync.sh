#!/usr/bin/env bash
set -euo pipefail

# Deterministic daily governance flow for Ikentic.
# 1) refresh ref truth
# 2) write gap + inventory reports
# 3) enforce stop/go checks before optional mechanical sync

usage() {
  cat <<'USAGE'
Usage: scripts/ikentic/daily-deterministic-sync.sh [options]

Options:
  --reports-dir <dir>          Output report directory (default: .ikentic/reports)
  --integration-ref <ref>      Integration ref for audits (default: origin/integration/ikentic)
  --required-lanes-file <path> Required lane policy file (default: docs/ikentic/required-lanes.txt)
  --run-sync                   Run scripts/ikentic/sync-main-into-integration.sh after gates pass
  --help                       Show this help

Exit codes:
  0 success
  2 blocking governance gate failed
  3 config/runtime error
USAGE
}

reports_dir=".ikentic/reports"
integration_ref="origin/integration/ikentic"
required_lanes_file="docs/ikentic/required-lanes.txt"
run_sync=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --reports-dir)
      reports_dir="${2:-}"
      shift 2
      ;;
    --integration-ref)
      integration_ref="${2:-}"
      shift 2
      ;;
    --required-lanes-file)
      required_lanes_file="${2:-}"
      shift 2
      ;;
    --run-sync)
      run_sync=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      usage >&2
      exit 3
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

run_cmd() {
  if command -v direnv >/dev/null 2>&1; then
    direnv exec . "$@"
  else
    "$@"
  fi
}

run_ts() {
  if command -v bun >/dev/null 2>&1; then
    run_cmd bun "$@"
  else
    run_cmd node --import tsx "$@"
  fi
}

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "working tree has tracked changes; commit/stash before running daily sync" >&2
  git status --porcelain >&2 || true
  exit 3
fi

run_cmd git fetch origin --prune
run_cmd git fetch upstream --prune

stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$reports_dir"
gap_report="${reports_dir}/gap-${stamp}.json"
inventory_report="${reports_dir}/inventory-${stamp}.json"
summary_report="${reports_dir}/daily-summary-${stamp}.txt"

set +e
run_ts scripts/ikentic-branch-gap-audit.ts \
  --integration-ref "$integration_ref" \
  --required-lanes-file "$required_lanes_file" \
  --format json > "$gap_report"
gap_status=$?
set -e

set +e
run_ts scripts/ikentic-branch-inventory.ts \
  --integration-ref "$integration_ref" \
  --required-lanes-file "$required_lanes_file" \
  --format json > "$inventory_report"
inventory_status=$?
set -e

ancestry_ok=0
if git merge-base --is-ancestor origin/main "$integration_ref"; then
  ancestry_ok=1
fi

{
  echo "timestamp=${stamp}"
  echo "integration_ref=${integration_ref}"
  echo "required_lanes_file=${required_lanes_file}"
  echo "gap_report=${gap_report}"
  echo "inventory_report=${inventory_report}"
  echo "gap_exit_code=${gap_status}"
  echo "inventory_exit_code=${inventory_status}"
  echo "main_ancestor_of_integration=${ancestry_ok}"
} > "$summary_report"

echo "daily summary: ${summary_report}"

if [[ "$ancestry_ok" -ne 1 ]]; then
  echo "blocking: integration ancestry invariant failed (origin/main is not ancestor of ${integration_ref})" >&2
  exit 2
fi
if [[ "$gap_status" -ne 0 ]]; then
  echo "blocking: carry required-lane gate failed (exit ${gap_status})" >&2
  exit 2
fi
if [[ "$inventory_status" -eq 3 ]]; then
  echo "blocking: inventory config/runtime error (exit ${inventory_status})" >&2
  exit 3
fi
if [[ "$inventory_status" -ne 0 ]]; then
  echo "review lane required: inventory reported missing/review-required commits (exit ${inventory_status})"
  if [[ "$run_sync" -eq 1 ]]; then
    echo "skipping mechanical sync because review-required items remain"
  fi
  exit 2
fi

if [[ "$run_sync" -eq 1 ]]; then
  exec "${repo_root}/scripts/ikentic/sync-main-into-integration.sh"
fi

echo "daily deterministic gates passed"

