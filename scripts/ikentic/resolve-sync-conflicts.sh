#!/usr/bin/env bash
set -euo pipefail

# Resolve deterministic conflict classes for main->integration sync.
#
# This resolver does not use `--ours/--theirs` shortcuts.
# It selects explicit index stages:
# - Stage 2: current branch side (integration-maintained)
# - Stage 3: merged-in side (upstream-first)
#
# Policy:
# - Class A (package.json): stage 3 (upstream-first baseline)
# - Class B (pnpm-lock.yaml): stage 3 now; always regenerate later
# - Class C (CHANGELOG.md): stage 2 (integration-maintained lane)
# - Class D: leave unresolved and return non-zero

if [[ "${1-}" == "--help" ]]; then
  cat <<'USAGE'
Usage: scripts/ikentic/resolve-sync-conflicts.sh

Runs on current in-progress merge and applies deterministic auto-resolution for
Class A/B/C conflicts. Leaves Class D unresolved and exits 2 if any remain.
USAGE
  exit 0
fi

write_stage_file() {
  local stage="$1"
  local file="$2"
  if ! git cat-file -e ":${stage}:${file}" 2>/dev/null; then
    echo "missing expected merge stage ${stage} for ${file}" >&2
    return 1
  fi
  git show ":${stage}:${file}" > "${file}"
}

mapfile -t unresolved < <(git diff --name-only --diff-filter=U)
if [[ "${#unresolved[@]}" -eq 0 ]]; then
  echo "No unresolved conflicts found"
  exit 0
fi

remaining=()

for file in "${unresolved[@]}"; do
  case "$file" in
    package.json|*/package.json)
      write_stage_file 3 "$file"
      git add "$file"
      echo "resolved A (upstream-first): $file"
      ;;
    pnpm-lock.yaml)
      write_stage_file 3 "$file"
      git add "$file"
      echo "resolved B (rebuild required): $file"
      ;;
    CHANGELOG.md|*/CHANGELOG.md)
      write_stage_file 2 "$file"
      git add "$file"
      echo "resolved C (integration-maintained): $file"
      ;;
    *)
      remaining+=("$file")
      ;;
  esac
done

if [[ "${#remaining[@]}" -gt 0 ]]; then
  echo "remaining Class D conflicts:" >&2
  printf '%s\n' "${remaining[@]}" >&2
  exit 2
fi

echo "Auto-resolution complete. Rebuild lockfile next: pnpm install --lockfile-only"

