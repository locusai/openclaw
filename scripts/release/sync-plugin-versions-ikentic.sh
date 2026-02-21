#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

CHANGELOG_FILES=()
while IFS= read -r -d '' path; do
  CHANGELOG_FILES+=("${path}")
  mkdir -p "${TMP_DIR}/$(dirname "${path}")"
  cp "${path}" "${TMP_DIR}/${path}"
done < <(find extensions -mindepth 2 -maxdepth 2 -name CHANGELOG.md -print0)

echo "plugins:sync:ikentic: syncing extension package versions"
node --import tsx scripts/sync-plugin-versions.ts "$@"

if ((${#CHANGELOG_FILES[@]} > 0)); then
  for path in "${CHANGELOG_FILES[@]}"; do
    cp "${TMP_DIR}/${path}" "${path}"
  done
fi

echo "plugins:sync:ikentic: restored ${#CHANGELOG_FILES[@]} extension changelog files"
