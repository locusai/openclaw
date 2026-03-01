#!/usr/bin/env bash
set -euo pipefail

# Build/update a deterministic upstream-candidate stack branch:
#   origin/main baseline + current open upstream PR patches.
#
# This is the supported way to test PRs "together" without polluting `pr/*`
# branches with integration-only commits.

usage() {
  cat <<'USAGE'
Usage: scripts/ikentic/update-stacked-carry.sh [options]

Options:
  --stack-base-ref <ref>    Stack baseline ref (default: origin/main)
  --integration-ref <ref>   DEPRECATED alias for --stack-base-ref
  --base-ref <ref>          Base for PR commit ranges (default: origin/main)
  --stack-branch <name>     Branch to update on origin (default: carry/stacked)
  --snapshot <tsv>          Snapshot TSV from snapshot-pr-refs.sh (optional)
  --reports-dir <dir>       Output reports directory (default: ${TMPDIR:-/tmp}/ikentic-reports)
  --skip-check              Skip pnpm check/build gates
  --dry-run                 Do not push; print what would happen
  --help                    Show this help

Exit codes:
  0 success
  2 governance gate failed (check/build/port conflict review required)
  3 config/runtime error
USAGE
}

stack_base_ref="origin/main"
base_ref="origin/main"
stack_branch="carry/stacked"
snapshot=""
reports_dir=""
run_check=1
dry_run=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --stack-base-ref)
      stack_base_ref="${2:-}"
      shift 2
      ;;
    --integration-ref)
      echo "warning: --integration-ref is deprecated; use --stack-base-ref" >&2
      stack_base_ref="${2:-}"
      shift 2
      ;;
    --base-ref)
      base_ref="${2:-}"
      shift 2
      ;;
    --stack-branch)
      stack_branch="${2:-}"
      shift 2
      ;;
    --snapshot)
      snapshot="${2:-}"
      shift 2
      ;;
    --reports-dir)
      reports_dir="${2:-}"
      shift 2
      ;;
    --skip-check)
      run_check=0
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
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

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Stage helper scripts to a stable tmp dir so branch switches (integration refs) don't change behavior.
tools_dir="$(mktemp -d /tmp/ikentic-stacked-tools-XXXXXX)"
stage_tool() {
  local f="$1"
  cp "${script_dir}/${f}" "${tools_dir}/${f}"
  chmod +x "${tools_dir}/${f}"
}
stage_tool "snapshot-pr-refs.sh"
stage_tool "port-pr-refs.sh"
stage_tool "check-lockfile-gates.sh"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "working tree has tracked changes; commit/stash before updating stacked carry" >&2
  git status --porcelain >&2 || true
  exit 3
fi

run_cmd git fetch origin --prune

stamp="$(date +%Y%m%d-%H%M%S)"
tmp_root="${TMPDIR:-/tmp}"
reports_dir="${reports_dir:-${tmp_root%/}/ikentic-reports}"
mkdir -p "$reports_dir"

if [[ -z "$snapshot" ]]; then
  snap_out="$("${tools_dir}/snapshot-pr-refs.sh")"
  echo "$snap_out"
  snapshot="$(echo "$snap_out" | awk '{print $2}')"
fi
if [[ ! -f "$snapshot" ]]; then
  echo "snapshot not found: $snapshot" >&2
  exit 3
fi

start_ref="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
tmp_branch="tmp/stacked-carry-${stamp}"
scratch_dir=""

cleanup() {
  if [[ -n "$start_ref" ]]; then
    git switch "$start_ref" >/dev/null 2>&1 || true
  fi
  if git show-ref --verify --quiet "refs/heads/${tmp_branch}"; then
    git branch -D "${tmp_branch}" >/dev/null 2>&1 || true
  fi
  if [[ -n "$scratch_dir" ]]; then
    rm -rf "$scratch_dir" >/dev/null 2>&1 || true
  fi
  rm -rf "$tools_dir" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git switch -c "$tmp_branch" "$stack_base_ref" >/dev/null

port_report="${reports_dir%/}/pr-port-${stamp}.tsv"
"${tools_dir}/port-pr-refs.sh" \
  --base "$base_ref" \
  --snapshot "$snapshot" \
  --deterministic-dates \
  --report "$port_report"

"${tools_dir}/check-lockfile-gates.sh" "$stack_base_ref" HEAD

if [[ "$run_check" -eq 1 ]]; then
  scratch_dir="$(mktemp -d /tmp/ikentic-stacked-scratch-XXXXXX)"
  mkdir -p "${scratch_dir}/home" "${scratch_dir}/cache"
  run_cmd env CI=true HOME="${scratch_dir}/home" XDG_CACHE_HOME="${scratch_dir}/cache" pnpm check
  run_cmd env CI=true HOME="${scratch_dir}/home" XDG_CACHE_HOME="${scratch_dir}/cache" pnpm build
fi

needs_review=0
if rg -q $'\tNEEDS_REVIEW\t' "$port_report"; then
  needs_review=1
fi
stale_snapshot=0
if rg -q $'\tSTALE_SNAPSHOT\t' "$port_report"; then
  stale_snapshot=1
fi

before_oid=""
if git show-ref --verify --quiet "refs/remotes/origin/${stack_branch}"; then
  before_oid="$(git rev-parse "origin/${stack_branch}")"
fi
after_oid="$(git rev-parse HEAD)"

if [[ "$dry_run" -eq 1 ]]; then
  echo "dry-run: would update origin/${stack_branch}"
  echo "  stack_base_ref=${stack_base_ref}"
  echo "  snapshot=${snapshot}"
  echo "  before_oid=${before_oid:-<new>}"
  echo "  after_oid=${after_oid}"
  echo "  port_report=${port_report}"
  if [[ "$needs_review" -eq 1 ]]; then
    echo "  note=port report contains NEEDS_REVIEW rows"
  fi
  if [[ "$stale_snapshot" -eq 1 ]]; then
    echo "  note=port report contains STALE_SNAPSHOT rows"
  fi
  exit 0
fi

# Snapshot drift breaks determinism. Do not update the stack branch.
if [[ "$stale_snapshot" -eq 1 ]]; then
  echo "blocking: snapshot drift detected; regenerate snapshot and retry (see report)" >&2
  echo "port report: ${port_report}" >&2
  exit 2
fi

# Non-clean PR ports break determinism. Do not update the stack branch.
if [[ "$needs_review" -eq 1 ]]; then
  echo "needs review: some PR commits did not apply cleanly; fix the PR refs and retry (see report)" >&2
  echo "port report: ${port_report}" >&2
  exit 2
fi

# Force-with-lease because this is a generated lane. Protect against remote drift.
if [[ -n "$before_oid" ]]; then
  git push --force-with-lease="${stack_branch}:${before_oid}" origin HEAD:"${stack_branch}"
else
  git push -u origin HEAD:"${stack_branch}"
fi

echo "updated origin/${stack_branch}: ${before_oid:-<new>} -> ${after_oid}"
echo "port report: ${port_report}"
