#!/usr/bin/env bash
set -euo pipefail

# Refresh origin/pr/* branches onto origin/main so upstream PR branches stay current.
#
# Implementation:
# - Enumerate origin/pr/* from a snapshot TSV or directly from refs.
# - For each branch:
#   - if already contains origin/main, skip
#   - else attempt a non-interactive rebase onto origin/main
#   - if clean, push back to origin with --force-with-lease (protects against remote drift)
#   - if conflicts, abort and record as NEEDS_MANUAL
#
# This script does not auto-resolve rebase conflicts.

usage() {
  cat <<'USAGE'
Usage: scripts/ikentic/refresh-pr-refs-with-main.sh [--snapshot <tsv>] [--dry-run]

Notes:
  - Requires clean working tree.
  - Pushes updates to origin/pr/* with --force-with-lease when rebase is clean.
  - If rebase conflicts, the branch is left unchanged and recorded as NEEDS_MANUAL.
  - Runs `pnpm check` on rebased branches by default; failures are recorded as NEEDS_MANUAL.
USAGE
}

snapshot=""
dry_run=0
run_check=1

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --help)
      usage
      exit 0
      ;;
    --snapshot)
      snapshot="${2:-}"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --skip-check)
      run_check=0
      shift
      ;;
    *)
      echo "unknown arg: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

run_check_isolated() (
  set -euo pipefail

  # `pnpm check` runs `oxfmt --check`, which scans the repo tree and can fail on
  # local agent scratch artifacts. Temporarily move known scratch dirs out of
  # the repo so the gate is about the rebased branch itself.
  tmp_hide="$(mktemp -d "${TMPDIR:-/tmp}/ikentic-hide-XXXXXX")"

  moved=()
  for d in ".ralph" ".ikentic"; do
    if [[ -e "$d" ]]; then
      mv "$d" "${tmp_hide}/"
      moved+=("$d")
    fi
  done

  cleanup_hide() {
    for x in "${moved[@]}"; do
      if [[ -e "${tmp_hide}/${x}" && ! -e "$x" ]]; then
        mv "${tmp_hide}/${x}" "$x"
      fi
    done
    rm -rf "$tmp_hide" >/dev/null 2>&1 || true
  }
  trap cleanup_hide EXIT

  if command -v direnv >/dev/null 2>&1; then
    direnv exec . env CI=true pnpm install --frozen-lockfile
    direnv exec . env CI=true pnpm check
  else
    env CI=true pnpm install --frozen-lockfile
    env CI=true pnpm check
  fi
)

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "working tree is dirty; commit/stash before refresh" >&2
  git status --porcelain >&2 || true
  exit 1
fi

stamp="$(date +%Y%m%d-%H%M%S)"
tmp_root="${TMPDIR:-/tmp}"
report_dir="${tmp_root%/}/ikentic-reports"
report="${report_dir}/pr-refresh-${stamp}.tsv"
mkdir -p "$report_dir"

get_refs() {
  if [[ -n "$snapshot" ]]; then
    if [[ ! -f "$snapshot" ]]; then
      echo "snapshot not found: $snapshot" >&2
      exit 1
    fi
    # Skip header.
    tail -n +2 "$snapshot" | awk -F '\t' '{print $1}'
    return 0
  fi
  git for-each-ref --format='%(refname:short)' refs/remotes/origin/pr | sort
}

echo -e "ref\tbefore_oid\taction\tafter_oid\tnote" > "$report"

failed=0

while IFS= read -r ref; do
  [[ -n "$ref" ]] || continue
  before_oid="$(git rev-parse "$ref")"
  branch="${ref#origin/}" # pr/<name>

  if git merge-base --is-ancestor origin/main "$ref" 2>/dev/null; then
    echo -e "${branch}\t${before_oid}\tSKIP_UP_TO_DATE\t${before_oid}\tcontains origin/main" >> "$report"
    continue
  fi

  tmp="codex/tmp-pr-refresh-${stamp}-$(echo "$branch" | tr '/.' '__' | tr -cd 'A-Za-z0-9_-')"
  git switch -c "$tmp" "$ref" >/dev/null

  set +e
  git -c rerere.enabled=false rebase origin/main >/dev/null 2>&1
  st=$?
  set -e

  if [[ "$st" -ne 0 ]]; then
    git rebase --abort >/dev/null 2>&1 || true
    echo -e "${branch}\t${before_oid}\tNEEDS_MANUAL\t\trebase conflict" >> "$report"
    failed=1
    git switch - >/dev/null
    git branch -D "$tmp" >/dev/null 2>&1 || true
    continue
  fi

  after_oid="$(git rev-parse HEAD)"

  if [[ "$dry_run" -eq 1 ]]; then
    echo -e "${branch}\t${before_oid}\tDRY_RUN_REBASED\t${after_oid}\twould push --force-with-lease" >> "$report"
    git switch - >/dev/null
    git branch -D "$tmp" >/dev/null 2>&1 || true
    continue
  fi

  if [[ "$run_check" -eq 1 ]]; then
    set +e
    run_check_isolated
    cst=$?
    set -e

    if [[ "$cst" -ne 0 ]]; then
      echo -e "${branch}\t${before_oid}\tNEEDS_MANUAL\t${after_oid}\tcheck failed (local branch ${tmp})" >> "$report"
      failed=1
      git switch - >/dev/null
      continue
    fi
  fi

  # Protect against remote drift: only update if origin still points at snapshot before_oid.
  set +e
  git push --force-with-lease="${branch}:${before_oid}" origin HEAD:"${branch}" >/dev/null 2>&1
  pst=$?
  set -e
  if [[ "$pst" -ne 0 ]]; then
    echo -e "${branch}\t${before_oid}\tPUSH_FAILED\t${after_oid}\tforce-with-lease rejected (remote moved?)" >> "$report"
    failed=1
  else
    echo -e "${branch}\t${before_oid}\tPUSHED\t${after_oid}\trebased onto origin/main" >> "$report"
  fi

  git switch - >/dev/null
  git branch -D "$tmp" >/dev/null 2>&1 || true
done < <(get_refs)

echo "pr refresh report: ${report}"
if [[ "$failed" -ne 0 ]]; then
  exit 2
fi
