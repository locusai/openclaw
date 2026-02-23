#!/usr/bin/env bash
set -euo pipefail

# Port origin/pr/* branches into the current branch via clean cherry-picks only.
#
# Rules:
# - Only cherry-pick commits that apply without conflicts.
# - On conflict, abort that cherry-pick and record it as NEEDS_REVIEW.
# - This is intended for mechanical lanes where manual conflict edits are forbidden.

usage() {
  cat <<'USAGE'
Usage: scripts/ikentic/port-pr-refs.sh [--report <tsv>] [--base <ref>] [--snapshot <tsv>]

Defaults:
  --base origin/main
  --report ${TMPDIR:-/tmp}/ikentic-reports/pr-port-<stamp>.tsv
  --snapshot (unset; enumerates refs/remotes/origin/pr directly)

Report columns:
  pr_ref<TAB>commit<TAB>action<TAB>note
USAGE
}

report=""
base_ref="origin/main"
snapshot=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --help)
      usage
      exit 0
      ;;
    --report)
      report="${2:-}"
      shift 2
      ;;
    --base)
      base_ref="${2:-}"
      shift 2
      ;;
    --snapshot)
      snapshot="${2:-}"
      shift 2
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

stamp="$(date +%Y%m%d-%H%M%S)"
tmp_root="${TMPDIR:-/tmp}"
report="${report:-${tmp_root%/}/ikentic-reports/pr-port-${stamp}.tsv}"
mkdir -p "$(dirname "$report")"
echo -e "pr_ref\tcommit\taction\tnote" > "$report"

refs=()
if [[ -n "$snapshot" ]]; then
  if [[ ! -f "$snapshot" ]]; then
    echo "snapshot not found: $snapshot" >&2
    exit 1
  fi
  while IFS=$'\t' read -r ref expected_oid _subject; do
    [[ -n "$ref" ]] || continue
    # Skip header.
    if [[ "$ref" == "ref" ]]; then
      continue
    fi
    if [[ -n "$expected_oid" ]]; then
      current_oid="$(git rev-parse "$ref")"
      if [[ "$current_oid" != "$expected_oid" ]]; then
        echo -e "${ref}\t\tSTALE_SNAPSHOT\tref moved (${expected_oid} -> ${current_oid})" >> "$report"
        continue
      fi
    fi
    refs+=("$ref")
  done < "$snapshot"
else
  while IFS= read -r ref; do
    [[ -n "$ref" ]] || continue
    refs+=("$ref")
  done < <(git for-each-ref --format='%(refname:short)' refs/remotes/origin/pr | sort)
fi

if [[ -z "$refs" ]]; then
  echo "no origin/pr/* refs found"
  exit 0
fi

for ref in "${refs[@]}"; do
  # Enumerate PR branch commits relative to main (oldest -> newest).
  commits=()
  while IFS= read -r commit; do
    [[ -n "$commit" ]] || continue
    commits+=("$commit")
  done < <(git rev-list --reverse --no-merges "${base_ref}..${ref}")
  if [[ "${#commits[@]}" -eq 0 ]]; then
    echo -e "${ref}\t\tSKIP\tno commits vs ${base_ref}" >> "$report"
    continue
  fi

  for sha in "${commits[@]}"; do
    # Skip if patch-id already present in current branch.
    if git cherry -v HEAD "$sha" 2>/dev/null | rg -q '^-'; then
      echo -e "${ref}\t${sha}\tALREADY_PRESENT\tpatch-id contained" >> "$report"
      continue
    fi

    set +e
    git cherry-pick -x "$sha" >/dev/null 2>&1
    st=$?
    set -e
    if [[ "$st" -ne 0 ]]; then
      git cherry-pick --abort >/dev/null 2>&1 || true
      echo -e "${ref}\t${sha}\tNEEDS_REVIEW\tcherry-pick conflict" >> "$report"
      break
    fi
    echo -e "${ref}\t${sha}\tPICKED\tclean" >> "$report"
  done
done

echo "pr port report: ${report}"
