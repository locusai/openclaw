#!/usr/bin/env bash
set -euo pipefail

# Classify unresolved merge conflicts.
# Class A: package.json files
# Class B: pnpm-lock.yaml
# Class C: CHANGELOG.md files
# Class D: all other files

if [[ "${1-}" == "--help" ]]; then
  cat <<'USAGE'
Usage: scripts/ikentic/classify-conflicts.sh [file ...]

Without args, reads unresolved paths from:
  git diff --name-only --diff-filter=U

With args, classifies provided file paths.
USAGE
  exit 0
fi

if [[ "$#" -gt 0 ]]; then
  mapfile -t files < <(printf '%s\n' "$@")
else
  mapfile -t files < <(git diff --name-only --diff-filter=U)
fi

if [[ "${#files[@]}" -eq 0 ]]; then
  echo "No unresolved conflicts found"
  exit 0
fi

for file in "${files[@]}"; do
  case "$file" in
    pnpm-lock.yaml)
      class="B"
      ;;
    package.json|*/package.json)
      class="A"
      ;;
    CHANGELOG.md|*/CHANGELOG.md)
      class="C"
      ;;
    *)
      class="D"
      ;;
  esac
  printf '%s\t%s\n' "$class" "$file"
done | sort | tee /dev/stderr | awk -F '\t' '
  { count[$1]++ }
  END {
    printf "summary:"
    for (i = 1; i <= 4; i++) {
      c = sprintf("%c", 64 + i)
      printf " %s=%d", c, (count[c] + 0)
    }
    printf "\n"
  }
'

