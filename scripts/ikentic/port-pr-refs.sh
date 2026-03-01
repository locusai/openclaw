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
Usage: scripts/ikentic/port-pr-refs.sh [--report <tsv>] [--base <ref>] [--snapshot <tsv>] [--skip-if-present-in <ref>] [--deterministic-dates]

Defaults:
  --base origin/main
  --report ${TMPDIR:-/tmp}/ikentic-reports/pr-port-<stamp>.tsv
  --snapshot (unset; enumerates refs/remotes/origin/pr directly)

Optional:
  --skip-if-present-in <ref>  Skip commits already present in <ref> by patch-id (or already reachable by commit).

Report columns:
  pr_ref<TAB>commit<TAB>action<TAB>note
USAGE
}

report=""
base_ref="origin/main"
snapshot=""
skip_if_present_in=""
deterministic_dates=0

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
    --skip-if-present-in)
      skip_if_present_in="${2:-}"
      shift 2
      ;;
    --deterministic-dates)
      deterministic_dates=1
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

stamp="$(date +%Y%m%d-%H%M%S)"
tmp_root="${TMPDIR:-/tmp}"
report="${report:-${tmp_root%/}/ikentic-reports/pr-port-${stamp}.tsv}"
mkdir -p "$(dirname "$report")"
echo -e "pr_ref\tcommit\taction\tnote" > "$report"

if [[ -n "$skip_if_present_in" ]]; then
  if ! git rev-parse --verify --quiet "${skip_if_present_in}^{commit}" >/dev/null; then
    echo "skip ref not found: ${skip_if_present_in}" >&2
    exit 1
  fi
fi

refs=()
if [[ -n "$snapshot" ]]; then
  if [[ ! -f "$snapshot" ]]; then
    echo "snapshot not found: $snapshot" >&2
    exit 1
  fi
  while IFS=$'\t' read -r ref expected_oid _subject; do
    [[ -n "$ref" ]] || continue
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
  if ! git merge-base --is-ancestor "${base_ref}" "${ref}" 2>/dev/null; then
    echo -e "${ref}\t\tNEEDS_REVIEW\tref is not descendant of ${base_ref}" >> "$report"
    continue
  fi

  # Enumerate PR branch commits relative to main (oldest -> newest).
  commits_all=()
  while IFS= read -r commit; do
    [[ -n "$commit" ]] || continue
    commits_all+=("$commit")
  done < <(git rev-list --reverse --no-merges "${base_ref}..${ref}")

  if [[ "${#commits_all[@]}" -eq 0 ]]; then
    echo -e "${ref}\t\tSKIP\tno commits vs ${base_ref}" >> "$report"
    continue
  fi

  if [[ -n "$skip_if_present_in" ]]; then
    not_reachable_file="$(mktemp)"
    git rev-list --no-merges "${base_ref}..${ref}" --not "${skip_if_present_in}" >"$not_reachable_file"

    patch_present_file="$(mktemp)"
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      if [[ "${line}" != -* ]]; then
        continue
      fi
      sha="$(echo "$line" | awk '{print $2}')"
      [[ -n "$sha" ]] || continue
      full_sha="$(git rev-parse "${sha}^{commit}" 2>/dev/null || true)"
      [[ -n "$full_sha" ]] || continue
      echo "$full_sha" >>"$patch_present_file"
    done < <(git cherry "$skip_if_present_in" "$ref" 2>/dev/null || true)
  fi

  for sha in "${commits_all[@]}"; do
    if [[ -n "$skip_if_present_in" ]]; then
      if ! grep -Fqx -- "$sha" "$not_reachable_file"; then
        echo -e "${ref}\t${sha}\tSKIP_PRESENT\talready reachable from ${skip_if_present_in}" >> "$report"
        continue
      fi
      if grep -Fqx -- "$sha" "$patch_present_file"; then
        echo -e "${ref}\t${sha}\tSKIP_PRESENT\tpatch already present in ${skip_if_present_in}" >> "$report"
        continue
      fi
    fi

    tmp="$(mktemp)"
    set +e
    if [[ "$deterministic_dates" -eq 1 ]]; then
      committer_date="$(git show -s --format=%cI "$sha")"
      GIT_COMMITTER_DATE="$committer_date" \
        git -c rerere.enabled=false -c rerere.autoupdate=false cherry-pick -x "$sha" >"$tmp" 2>&1
    else
      git -c rerere.enabled=false -c rerere.autoupdate=false cherry-pick -x "$sha" >"$tmp" 2>&1
    fi
    st=$?
    set -e
    if [[ "$st" -ne 0 ]] && rg -q "previous cherry-pick is now empty" "$tmp"; then
      git cherry-pick --skip >/dev/null 2>&1 || true
      echo -e "${ref}\t${sha}\tSKIP_EMPTY\talready applied via earlier picks" >> "$report"
      rm -f "$tmp"
      continue
    fi
    rm -f "$tmp"
    if [[ "$st" -ne 0 ]]; then
      git cherry-pick --abort >/dev/null 2>&1 || true
      echo -e "${ref}\t${sha}\tNEEDS_REVIEW\tcherry-pick conflict" >> "$report"
      break
    fi
    echo -e "${ref}\t${sha}\tPICKED\tclean" >> "$report"
  done

  if [[ -n "$skip_if_present_in" ]]; then
    rm -f "${not_reachable_file:-}" "${patch_present_file:-}" >/dev/null 2>&1 || true
  fi
done

echo "pr port report: ${report}"
