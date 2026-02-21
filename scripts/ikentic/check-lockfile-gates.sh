#!/usr/bin/env bash
set -euo pipefail

# Enforce deterministic lockfile gates for sync/release branches.
#
# Gate 1: dependency-affecting manifest changes require pnpm-lock.yaml change.
# - Version-only or scripts-only changes do not require lockfile changes.
# Gate 2: pnpm install --frozen-lockfile must succeed.

if [[ "${1-}" == "--help" ]]; then
  cat <<'USAGE'
Usage: scripts/ikentic/check-lockfile-gates.sh [<base-ref> [<head-ref>]]

Defaults:
  base-ref = origin/integration/ikentic
  head-ref = HEAD
USAGE
  exit 0
fi

base_ref="${1:-origin/integration/ikentic}"
head_ref="${2:-HEAD}"

diff_files="$(git diff --name-only "${base_ref}...${head_ref}")"

lock_changed=0
if printf '%s\n' "$diff_files" | rg -q '^pnpm-lock\.yaml$'; then
  lock_changed=1
fi

mapfile -t pkg_files < <(printf '%s\n' "$diff_files" | rg '(^|/)package\.json$' || true)

if [[ "${#pkg_files[@]}" -gt 0 && "$lock_changed" -eq 0 ]]; then
  # Determine whether any changed package.json modified dependency-affecting keys.
  if node --input-type=module - "$base_ref" "$head_ref" "${pkg_files[@]}" <<'NODE'
import { execFileSync } from "node:child_process";

const [baseRef, headRef, ...files] = process.argv.slice(1);
const depKeys = new Set([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundledDependencies",
  "overrides",
  "resolutions",
  "pnpm",
  "packageManager",
]);

function gitShow(ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

function parseJson(text, file, ref) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse ${ref}:${file} as JSON: ${String(err)}`);
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

const offenders = [];
for (const file of files) {
  const baseText = gitShow(baseRef, file);
  const headText = gitShow(headRef, file);
  if (!baseText || !headText) {
    offenders.push(`${file} (added/removed)`);
    continue;
  }
  const basePkg = parseJson(baseText, file, baseRef);
  const headPkg = parseJson(headText, file, headRef);
  for (const key of depKeys) {
    const a = stableStringify(basePkg[key]);
    const b = stableStringify(headPkg[key]);
    if (a !== b) {
      offenders.push(`${file} (${key})`);
      break;
    }
  }
}

if (offenders.length > 0) {
  console.error(JSON.stringify({ requiresLockfile: true, offenders }, null, 2));
  process.exit(2);
}
process.exit(0);
NODE
  then
    :
  else
    status=$?
    if [[ "$status" -eq 2 ]]; then
      echo "lockfile gate failed: dependency-affecting package.json changes without pnpm-lock.yaml change" >&2
      echo "base/head: ${base_ref}...${head_ref}" >&2
      exit 1
    fi
    exit "$status"
  fi
fi

if command -v direnv >/dev/null 2>&1; then
  # pnpm may prompt to remove node_modules; force non-interactive behavior.
  direnv exec . env CI=true pnpm install --frozen-lockfile
else
  env CI=true pnpm install --frozen-lockfile
fi

echo "lockfile gates passed"

