#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

usage() {
  cat <<'USAGE'
Ikentic ops CLI

Usage:
  scripts/ikentic/cli.sh <command> [args...]

Commands:
  sync-main
    Run deterministic mirror->integration bootstrap.

  classify-conflicts [file ...]
    Classify unresolved (or provided) paths into conflict classes A/B/C/D.

  resolve-conflicts
    Auto-resolve deterministic conflict classes A/B/C; leaves D unresolved.

  check-lockfile-gates [<base-ref> [<head-ref>]]
    Enforce manifest/lockfile consistency and frozen lockfile install.

  snapshot-open-prs [<output-json>]
    Snapshot open PR heads for main-based pr/* branches.
    Default output: .ikentic/ledger/open-main-prs.json

  stage-tools [<output-dir>]
    Copy current ikentic scripts into a stable tmp/tool directory and print path.
    Default output-dir: mktemp under /tmp (ikentic-cli-XXXXXX)

  ledger-refresh [<base-ref> [<head-ref> [<output-tsv>]]]
    Build first-parent ledger with lane classification and automatic supersession pruning.
    Writes:
      - effective ledger to <output-tsv>
      - raw ledger to <output-tsv>.raw.tsv
      - dropped entries to <output-tsv>.dropped.tsv
    Default: origin/main..origin/integration/ikentic -> .ikentic/ledger/first-parent.tsv

  ledger-validate [<ledger-tsv> [<allow-unknown-file>]]
    Validate ordering + coverage:
      - fails on unknown lane entries not listed in allow-unknown-file
      - fails if review_pr appears before the first mechanical entry

  help
    Show this message.
USAGE
}

run_cmd() {
  if command -v direnv >/dev/null 2>&1; then
    direnv exec . "$@"
  else
    "$@"
  fi
}

classify_lane() {
  local subject="$1"

  case "$subject" in
    "sync integration with mirror main"|"sync: merge mechanical mirror payload from main"|"sync: isolate mechanical mirror payload")
      echo "mechanical"
      return
      ;;
    "rebuild: replay "*|"sync: port pr/"*|"plugins: add async loader with shared candidate flow"|"plugins: preserve explicit memory slot none in loader")
      echo "review_pr"
      return
      ;;
    "release:"*|"ci(release):"*|"ci: add ikentic publish sanity gate and fix ui prepack blockers"|"ci: keep ikentic sanity check pre-build only"|"ci: disable docker-release auto triggers"|"apply carry patchset: publish"|"carry: semver prerelease support for npm publish"|"merge: promote "*|"promote carry/publish into integration/ikentic"*)
      echo "release"
      return
      ;;
    "merge carry/docs into integration/ikentic"|"docs:"*|"docs("*)
      echo "docs"
      return
      ;;
    *)
      echo "unknown"
      return
      ;;
  esac
}

cmd_snapshot_open_prs() {
  local out="${1:-.ikentic/ledger/open-main-prs.json}"
  mkdir -p "$(dirname "$out")"
  run_cmd gh pr list \
    --repo locusai/openclaw \
    --state open \
    --search "base:main head:pr/" \
    --limit 200 \
    --json number,title,headRefName,baseRefName,headRefOid,url > "$out"
  local count
  count="$(jq 'length' "$out")"
  echo "snapshot: ${out} (${count} rows)"
}

cmd_stage_tools() {
  local out_dir="${1:-}"
  if [[ -z "$out_dir" ]]; then
    out_dir="$(mktemp -d /tmp/ikentic-cli-XXXXXX)"
  fi

  mkdir -p "$out_dir"
  local files=(
    "cli.sh"
    "sync-main-into-integration.sh"
    "classify-conflicts.sh"
    "resolve-sync-conflicts.sh"
    "check-lockfile-gates.sh"
  )

  local f
  for f in "${files[@]}"; do
    cp "${script_dir}/${f}" "${out_dir}/${f}"
    chmod +x "${out_dir}/${f}"
  done

  echo "staged tools: ${out_dir}"
}

cmd_ledger_refresh() {
  local base_ref="${1:-origin/main}"
  local head_ref="${2:-origin/integration/ikentic}"
  local out="${3:-.ikentic/ledger/first-parent.tsv}"
  mkdir -p "$(dirname "$out")"

  local raw_out dropped_out
  raw_out="${out}.raw.tsv"
  dropped_out="${out}.dropped.tsv"
  rm -f "$out" "$dropped_out"

  local tmp
  tmp="$(mktemp)"
  git log --first-parent --reverse --format='%H%x09%P%x09%s' "${base_ref}..${head_ref}" | \
    while IFS=$'\t' read -r commit parents subject; do
      [[ -n "$commit" ]] || continue
      lane="$(classify_lane "$subject")"
      printf '%s\t%s\t%s\t%s\n' "$commit" "$parents" "$subject" "$lane"
    done > "$tmp"

  mv "$tmp" "$raw_out"

  # Prune superseded entries into effective replay ledger.
  # Rules:
  # - drop review_pr entries that occur before first mechanical marker
  # - keep only newest review_pr entry per key (pr/<name>, feat/<name>, fallback subject)
  # - drop release entries older than the newest integration promotion from carry/publish
  awk -F '\t' -v OFS='\t' -v out="$out" -v dropped="$dropped_out" '
    function review_key(s) {
      if (match(s, /pr\/[A-Za-z0-9._-]+/)) return substr(s, RSTART, RLENGTH)
      if (match(s, /feat\/[A-Za-z0-9._-]+/)) return substr(s, RSTART, RLENGTH)
      return "subject:" s
    }

    {
      n++
      c[n]=$1
      p[n]=$2
      s[n]=$3
      l[n]=$4
    }

    END {
      first_mechanical=0
      latest_integration_promotion=0

      for (i = 1; i <= n; i++) {
        if (first_mechanical == 0 && l[i] == "mechanical") {
          first_mechanical = i
        }
        if (l[i] == "release" && (s[i] ~ /^merge: promote carry\/publish into integration\/ikentic/ || s[i] ~ /^promote carry\/publish into integration\/ikentic/)) {
          latest_integration_promotion = i
        }
      }

      for (i = n; i >= 1; i--) {
        reason = ""

        if (l[i] == "review_pr" && first_mechanical > 0 && i < first_mechanical) {
          reason = "legacy_review_pre_mechanical"
        } else if (l[i] == "review_pr") {
          key = review_key(s[i])
          if (seen_review[key]++ > 0) {
            reason = "superseded_review_key:" key
          }
        } else if (l[i] == "release" && latest_integration_promotion > 0 && i < latest_integration_promotion) {
          reason = "covered_by_latest_integration_promotion"
        }

        if (reason == "") {
          keep[i] = 1
        } else {
          drop_reason[i] = reason
          drop_count++
        }
      }

      for (i = 1; i <= n; i++) {
        if (keep[i]) {
          print c[i], p[i], s[i], l[i] > out
        } else {
          print c[i], p[i], s[i], l[i], drop_reason[i] > dropped
        }
      }
    }
  ' "$raw_out"

  local total kept dropped mechanical review_pr release docs unknown
  total="$(wc -l < "$raw_out" | tr -d ' ')"
  kept="$(wc -l < "$out" | tr -d ' ')"
  dropped=0
  if [[ -f "$dropped_out" ]]; then
    dropped="$(wc -l < "$dropped_out" | tr -d ' ')"
  fi
  mechanical="$(awk -F '\t' '$4=="mechanical"{c++} END{print c+0}' "$out")"
  review_pr="$(awk -F '\t' '$4=="review_pr"{c++} END{print c+0}' "$out")"
  release="$(awk -F '\t' '$4=="release"{c++} END{print c+0}' "$out")"
  docs="$(awk -F '\t' '$4=="docs"{c++} END{print c+0}' "$out")"
  unknown="$(awk -F '\t' '$4=="unknown"{c++} END{print c+0}' "$out")"

  echo "ledger: ${out}"
  echo "raw_ledger: ${raw_out}"
  echo "dropped_ledger: ${dropped_out}"
  echo "summary: total=${total} kept=${kept} dropped=${dropped} mechanical=${mechanical} review_pr=${review_pr} release=${release} docs=${docs} unknown=${unknown}"
  if [[ -f "$dropped_out" && "$dropped" -gt 0 ]]; then
    echo "drop_reasons:"
    awk -F '\t' '{r[$5]++} END {for (k in r) printf "  %s=%d\n", k, r[k]}' "$dropped_out" | sort
  fi
}

cmd_ledger_validate() {
  local ledger="${1:-.ikentic/ledger/first-parent.tsv}"
  local allow_file="${2:-}"

  if [[ ! -f "$ledger" ]]; then
    echo "ledger not found: ${ledger}" >&2
    exit 1
  fi

  declare -A allow_unknown
  if [[ -n "$allow_file" && -f "$allow_file" ]]; then
    while IFS= read -r line; do
      line="${line%%#*}"
      line="$(echo "$line" | tr -d '[:space:]')"
      [[ -n "$line" ]] || continue
      allow_unknown["$line"]=1
    done < "$allow_file"
  fi

  local idx=0
  local first_mechanical=0
  local review_before_mechanical=0
  local unknown_count=0
  local allowed_unknown_count=0
  local unknown_block=""
  local ordering_block=""

  while IFS=$'\t' read -r commit _ subject lane; do
    idx=$((idx + 1))
    case "$lane" in
      mechanical)
        if [[ "$first_mechanical" -eq 0 ]]; then
          first_mechanical="$idx"
        fi
        ;;
      review_pr)
        if [[ "$first_mechanical" -eq 0 ]]; then
          review_before_mechanical=$((review_before_mechanical + 1))
          ordering_block+="${commit} | ${subject}"$'\n'
        fi
        ;;
      unknown)
        if [[ -n "${allow_unknown[$commit]:-}" ]]; then
          allowed_unknown_count=$((allowed_unknown_count + 1))
        else
          unknown_count=$((unknown_count + 1))
          unknown_block+="${commit} | ${subject}"$'\n'
        fi
        ;;
      release|docs)
        ;;
      *)
        unknown_count=$((unknown_count + 1))
        unknown_block+="${commit} | invalid lane ${lane} | ${subject}"$'\n'
        ;;
    esac
  done < "$ledger"

  echo "validate: ${ledger}"
  echo "summary: first_mechanical_index=${first_mechanical} review_before_mechanical=${review_before_mechanical} unknown=${unknown_count} allowed_unknown=${allowed_unknown_count}"

  local failed=0
  if [[ "$review_before_mechanical" -gt 0 ]]; then
    failed=1
    echo "ordering violation: review_pr entries appear before first mechanical entry:" >&2
    printf '%s' "$ordering_block" >&2
  fi
  if [[ "$unknown_count" -gt 0 ]]; then
    failed=1
    echo "coverage violation: unknown lane entries found:" >&2
    printf '%s' "$unknown_block" >&2
  fi

  if [[ "$failed" -ne 0 ]]; then
    exit 2
  fi

  echo "ledger validation passed"
}

cmd="${1:-help}"
if [[ "$#" -gt 0 ]]; then
  shift
fi

case "$cmd" in
  sync-main)
    exec "$script_dir/sync-main-into-integration.sh" "$@"
    ;;
  classify-conflicts)
    exec "$script_dir/classify-conflicts.sh" "$@"
    ;;
  resolve-conflicts)
    exec "$script_dir/resolve-sync-conflicts.sh" "$@"
    ;;
  check-lockfile-gates)
    exec "$script_dir/check-lockfile-gates.sh" "$@"
    ;;
  snapshot-open-prs)
    cmd_snapshot_open_prs "$@"
    ;;
  stage-tools)
    cmd_stage_tools "$@"
    ;;
  ledger-refresh)
    cmd_ledger_refresh "$@"
    ;;
  ledger-validate)
    cmd_ledger_validate "$@"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "unknown command: ${cmd}" >&2
    usage >&2
    exit 1
    ;;
esac
