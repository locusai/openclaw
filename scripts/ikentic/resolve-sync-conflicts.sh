#!/usr/bin/env bash
set -euo pipefail

# Resolve deterministic conflict classes for main->integration sync.
# Class A (package.json): take --theirs (upstream/main)
# Class C (CHANGELOG.md): take --ours (integration lane)
# Class B (pnpm-lock.yaml): take --theirs now; always rebuild later
# Class D: leave unresolved and return non-zero

if [[ "${1-}" == "--help" ]]; then
  cat <<'USAGE'
Usage: scripts/ikentic/resolve-sync-conflicts.sh

Runs on current in-progress merge and applies deterministic auto-resolution for
Class A/B/C conflicts. Leaves Class D unresolved and exits 2 if any remain.
USAGE
  exit 0
fi

mapfile -t unresolved < <(git diff --name-only --diff-filter=U)
if [[ "${#unresolved[@]}" -eq 0 ]]; then
  echo "No unresolved conflicts found"
  exit 0
fi

remaining=()

for file in "${unresolved[@]}"; do
  case "$file" in
    package.json|*/package.json)
      git checkout --theirs -- "$file"
      git add "$file"
      echo "resolved A (--theirs): $file"
      ;;
    pnpm-lock.yaml)
      git checkout --theirs -- "$file"
      git add "$file"
      echo "resolved B (--theirs, rebuild required): $file"
      ;;
    CHANGELOG.md|*/CHANGELOG.md)
      git checkout --ours -- "$file"
      git add "$file"
      echo "resolved C (--ours): $file"
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
