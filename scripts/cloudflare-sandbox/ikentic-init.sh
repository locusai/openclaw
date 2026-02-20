#!/usr/bin/env bash
set -euo pipefail

TAG="[ikentic-init]"

if [ "${IKENTIC_ENABLED:-}" != "true" ]; then
  echo "${TAG} IKENTIC disabled"
  exit 0
fi

OPENCLAW_ROOT="${OPENCLAW_ROOT:-/app}"
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-${OPENCLAW_CONFIG_DIR:-/root/.openclaw}/openclaw.json}"
IKENTIC_PLUGIN_PATH="${IKENTIC_PLUGIN_PATH:-${OPENCLAW_ROOT}/extensions/openclaw-ikentic-plugin}"
export OPENCLAW_CONFIG_PATH

cd "$OPENCLAW_ROOT"

IKENTIC_PLUGIN_ID="${IKENTIC_PLUGIN_ID:-}"
if [ -z "$IKENTIC_PLUGIN_ID" ]; then
  IKENTIC_PLUGIN_ID="$(
    node -e '
      const fs = require("node:fs");
      const p = process.argv[1];
      try {
        const raw = fs.readFileSync(p, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.id === "string" && parsed.id.trim()) process.stdout.write(parsed.id.trim());
      } catch {}
    ' "$IKENTIC_PLUGIN_PATH/openclaw.plugin.json"
  )"
fi
IKENTIC_PLUGIN_ID="${IKENTIC_PLUGIN_ID:-ikentic}"
export IKENTIC_PLUGIN_ID

if [ ! -f "$OPENCLAW_CONFIG_PATH" ]; then
  echo "${TAG} ERROR: OPENCLAW_CONFIG_PATH not found: ${OPENCLAW_CONFIG_PATH}" >&2
  exit 1
fi

if [ ! -f "$IKENTIC_PLUGIN_PATH/openclaw.plugin.json" ]; then
  echo "${TAG} ERROR: IKENTIC plugin not found at ${IKENTIC_PLUGIN_PATH}" >&2
  exit 1
fi

echo "${TAG} Generating IKENTIC config..."
node "$IKENTIC_PLUGIN_PATH/scripts/gen-config.mjs" --config "$OPENCLAW_CONFIG_PATH"

echo "${TAG} Enabling IKENTIC plugin..."
if command -v openclaw >/dev/null 2>&1; then
  openclaw plugins enable "$IKENTIC_PLUGIN_ID" 2>/dev/null || true
else
  node "${OPENCLAW_ROOT}/openclaw.mjs" plugins enable "$IKENTIC_PLUGIN_ID" 2>/dev/null || true
fi

echo "${TAG} Sanitizing legacy allowlist entries..."
node -e '
  const fs = require("node:fs");
  const JSON5 = require("json5");
  const p = process.env.OPENCLAW_CONFIG_PATH;
  const raw = fs.readFileSync(p, "utf8");
  const cfg = JSON5.parse(raw);
  if (Array.isArray(cfg?.plugins?.allow)) {
    cfg.plugins.allow = cfg.plugins.allow.filter((id) => id !== "openclaw-ikentic-plugin");
  }
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
' 

echo "${TAG} IKENTIC init complete"
