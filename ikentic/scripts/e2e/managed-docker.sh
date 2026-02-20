#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

usage() {
  cat >&2 <<'EOF'
Usage: bash ikentic/scripts/e2e/managed-docker.sh <scenario>

Scenarios:
  persistence  Assert managed config is stable across restart
  schema       Assert schema-safe persisted config (no policy key)
EOF
}

normalize_host_path() {
  local p="$1"
  if [[ "$p" == /Volumes/devel/openclaw-work/* ]]; then
    printf "/mnt/shared_dirs/%s" "${p#/Volumes/devel/openclaw-work/}"
    return
  fi
  printf "%s" "$p"
}

resolve_plugin_dir() {
  if [[ -n "${IKENTIC_PLUGIN_HOST_DIR:-}" ]]; then
    normalize_host_path "$IKENTIC_PLUGIN_HOST_DIR"
    return
  fi

  local candidates=(
    "$ROOT_DIR/../ike-agents-managed-control-plane/packages/openclaw-ikentic-plugin"
    "$ROOT_DIR/../ike-agents/packages/openclaw-ikentic-plugin"
    "/Volumes/devel/openclaw-work/openclaw/ike-agents-managed-control-plane/packages/openclaw-ikentic-plugin"
    "/Volumes/devel/openclaw-work/openclaw/ike-agents/packages/openclaw-ikentic-plugin"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -d "$candidate" ]]; then
      normalize_host_path "$candidate"
      return
    fi
  done

  echo "Unable to resolve IKENTIC plugin host dir." >&2
  echo "Set IKENTIC_PLUGIN_HOST_DIR to your plugin path and retry." >&2
  exit 1
}

init_state_dirs() {
  local run_prefix="$1"

  local state_root="${IKENTIC_E2E_STATE_ROOT:-/mnt/shared_dirs/.openclaw-state}"
  if ! mkdir -p "$state_root" 2>/dev/null; then
    state_root="/tmp/.openclaw-state"
    mkdir -p "$state_root"
  fi

  local run_id
  run_id="${run_prefix}-$(date +%Y%m%d%H%M%S)-$$"

  export OPENCLAW_CONFIG_DIR="${IKENTIC_E2E_CONFIG_DIR:-$state_root/$run_id/config}"
  export OPENCLAW_WORKSPACE_DIR="${IKENTIC_E2E_WORKSPACE_DIR:-$state_root/$run_id/workspace}"
  export IKENTIC_PLUGIN_HOST_DIR
  IKENTIC_PLUGIN_HOST_DIR="$(resolve_plugin_dir)"
  export OPENCLAW_GATEWAY_PORT="${IKENTIC_E2E_GATEWAY_PORT:-18789}"
  export OPENCLAW_GATEWAY_TOKEN="${IKENTIC_E2E_GATEWAY_TOKEN:-ikentic-e2e-token}"

  mkdir -p "$OPENCLAW_CONFIG_DIR" "$OPENCLAW_WORKSPACE_DIR"
}

compose_cmd() {
  env \
    OPENCLAW_CONFIG_DIR="$OPENCLAW_CONFIG_DIR" \
    OPENCLAW_WORKSPACE_DIR="$OPENCLAW_WORKSPACE_DIR" \
    IKENTIC_PLUGIN_HOST_DIR="$IKENTIC_PLUGIN_HOST_DIR" \
    OPENCLAW_GATEWAY_PORT="$OPENCLAW_GATEWAY_PORT" \
    OPENCLAW_GATEWAY_TOKEN="$OPENCLAW_GATEWAY_TOKEN" \
    docker compose \
      -f "$ROOT_DIR/docker-compose.ikentic.yml" \
      -f "$ROOT_DIR/docker-compose.ikentic-mount-all.yml" \
      "$@"
}

cleanup() {
  compose_cmd down >/dev/null 2>&1 || true
  if [[ "${IKENTIC_E2E_KEEP_STATE:-0}" != "1" ]]; then
    rm -rf "$OPENCLAW_CONFIG_DIR" "$OPENCLAW_WORKSPACE_DIR"
  else
    echo "Keeping state dirs:"
    echo "  OPENCLAW_CONFIG_DIR=$OPENCLAW_CONFIG_DIR"
    echo "  OPENCLAW_WORKSPACE_DIR=$OPENCLAW_WORKSPACE_DIR"
  fi
}

wait_for_gateway_ready() {
  local timeout_s="${1:-120}"
  local i

  for ((i = 0; i < timeout_s; i += 1)); do
    local logs
    logs="$(compose_cmd logs --no-color --tail 200 openclaw 2>&1 || true)"

    if grep -qE "Config invalid|must NOT have additional properties" <<<"$logs"; then
      echo "Gateway reported invalid config:" >&2
      compose_cmd logs --no-color --tail 200 openclaw >&2 || true
      return 1
    fi

    if grep -q "listening on ws://" <<<"$logs"; then
      return 0
    fi

    sleep 1
  done

  echo "Timed out waiting for gateway readiness." >&2
  compose_cmd logs --no-color --tail 200 openclaw >&2 || true
  return 1
}

assert_no_invalid_logs() {
  local logs
  logs="$(compose_cmd logs --no-color --tail 220 openclaw 2>&1 || true)"
  if grep -qE "Config invalid|must NOT have additional properties" <<<"$logs"; then
    echo "Found invalid-config markers in logs." >&2
    compose_cmd logs --no-color --tail 220 openclaw >&2 || true
    return 1
  fi
}

start_stack() {
  compose_cmd down >/dev/null 2>&1 || true
  compose_cmd up -d --build
}

capture_managed_state() {
  compose_cmd exec -T openclaw node -e '
const fs = require("node:fs");
const cfg = JSON.parse(fs.readFileSync("/home/node/.openclaw/openclaw.json", "utf8"));
const entry = cfg?.plugins?.entries?.["openclaw-ikentic-plugin"] ?? {};
const pluginCfg = entry?.config ?? {};
const out = {
  personas: pluginCfg.personas ?? null,
  approvals: pluginCfg.approvals ?? null,
  auth: pluginCfg.auth ?? null,
  ike: pluginCfg.ike ?? null,
  policyPresent: Object.prototype.hasOwnProperty.call(pluginCfg, "policy"),
};
process.stdout.write(JSON.stringify(out));
'
}

assert_state_shape() {
  local state_json="$1"
  STATE_JSON="$state_json" node -e '
const state = JSON.parse(process.env.STATE_JSON || "{}");
if (!state.personas || typeof state.personas.mode !== "string") {
  throw new Error("missing personas.mode");
}
if (!state.approvals || typeof state.approvals.command !== "string") {
  throw new Error("missing approvals.command");
}
if (!state.auth || typeof state.auth.pendingTtlSeconds !== "number") {
  throw new Error("missing auth.pendingTtlSeconds");
}
if (!state.ike || typeof state.ike.apiBaseUrl !== "string") {
  throw new Error("missing ike.apiBaseUrl");
}
'
}

assert_policy_not_persisted() {
  compose_cmd exec -T openclaw node -e '
const fs = require("node:fs");
const cfg = JSON.parse(fs.readFileSync("/home/node/.openclaw/openclaw.json", "utf8"));
const pluginCfg = cfg?.plugins?.entries?.["openclaw-ikentic-plugin"]?.config ?? {};
if (Object.prototype.hasOwnProperty.call(pluginCfg, "policy")) {
  throw new Error("policy was persisted into plugin config");
}
if (!pluginCfg.personas || !pluginCfg.approvals || !pluginCfg.auth || !pluginCfg.ike) {
  throw new Error("expected managed sections are missing");
}
'
}

run_persistence_scenario() {
  init_state_dirs "ikentic-managed-persist"
  trap cleanup EXIT

  echo "Using plugin mount: $IKENTIC_PLUGIN_HOST_DIR"
  echo "Config dir: $OPENCLAW_CONFIG_DIR"
  echo "Workspace dir: $OPENCLAW_WORKSPACE_DIR"

  start_stack
  wait_for_gateway_ready

  local before_state
  before_state="$(capture_managed_state)"
  assert_state_shape "$before_state"

  compose_cmd restart openclaw >/dev/null
  wait_for_gateway_ready

  local after_state
  after_state="$(capture_managed_state)"
  assert_state_shape "$after_state"

  if [[ "$before_state" != "$after_state" ]]; then
    echo "Managed config changed across restart." >&2
    echo "Before: $before_state" >&2
    echo "After:  $after_state" >&2
    exit 1
  fi

  echo "OK: managed config persisted and remained stable across restart."
}

run_schema_scenario() {
  init_state_dirs "ikentic-managed-schema"
  trap cleanup EXIT

  echo "Using plugin mount: $IKENTIC_PLUGIN_HOST_DIR"
  echo "Config dir: $OPENCLAW_CONFIG_DIR"
  echo "Workspace dir: $OPENCLAW_WORKSPACE_DIR"

  start_stack
  wait_for_gateway_ready
  assert_policy_not_persisted
  assert_no_invalid_logs

  compose_cmd restart openclaw >/dev/null
  wait_for_gateway_ready
  assert_policy_not_persisted
  assert_no_invalid_logs

  echo "OK: schema-safe managed persistence verified (policy not persisted, startup healthy)."
}

main() {
  local scenario="${1:-}"
  case "$scenario" in
    persistence)
      run_persistence_scenario
      ;;
    schema)
      run_schema_scenario
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
