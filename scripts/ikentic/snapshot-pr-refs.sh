#!/usr/bin/env bash
set -euo pipefail

# Snapshot origin/pr/* refs (source of truth for upstream-bound PR branches).
# Output is a TSV with:
#   ref<TAB>head_oid<TAB>subject

usage() {
  cat <<'USAGE'
Usage: scripts/ikentic/snapshot-pr-refs.sh [<output-tsv>]

Default output:
  .ikentic/snapshots/origin-pr-refs-<stamp>.tsv
USAGE
}

if [[ "${1-}" == "--help" ]]; then
  usage
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

stamp="$(date +%Y%m%d-%H%M%S)"
out="${1:-.ikentic/snapshots/origin-pr-refs-${stamp}.tsv}"
mkdir -p "$(dirname "$out")"

{
  printf 'ref\thead_oid\tsubject\n'
  git for-each-ref \
    --format='%(refname:short)\t%(objectname)\t%(subject)' \
    refs/remotes/origin/pr | sort
} > "$out"

count="$(( $(wc -l < "$out") - 1 ))"
echo "snapshot: ${out} (${count} refs)"

