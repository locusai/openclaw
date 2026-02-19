#!/usr/bin/env bash
# docker-ikentic-entrypoint.sh — Dual-mode IKENTIC plugin init for Docker.
#
# Mode detection:
#   1. Volume mount (dev): /mnt/ikentic-plugin/openclaw.plugin.json exists
#   2. NPM cached:         ~/.openclaw/extensions/openclaw-ikentic-plugin/ exists
#   3. NPM install:        runs `plugins install` (requires NODE_AUTH_TOKEN)
#
# Expected to run as root (user: "0" in compose); drops to `node` via runuser.
set -euo pipefail

TAG="[ikentic-init]"

# --- Phase 1: root — fix volume ownership ------------------------------------
chown node:node /home/node/.openclaw

# --- Phase 2: node — detect mode, install/link plugin, start gateway ---------
exec runuser -u node -- bash -c '
set -euo pipefail

TAG="[ikentic-init]"
cd /app

EXTENSIONS_DIR="/home/node/.openclaw/extensions"
NPM_CACHE_DIR="$EXTENSIONS_DIR/openclaw-ikentic-plugin"
DEV_MOUNT="/mnt/ikentic-plugin"
DEV_MARKER="$DEV_MOUNT/openclaw.plugin.json"

# Helper: ensure json5 is available in a plugin directory (needed by gen-config.mjs).
# The published package may list json5 as a devDependency, so it is not installed
# by npm install --omit=dev. Copy from the host app node_modules as a fallback.
ensure_json5() {
  local dir="$1"
  if [ ! -d "$dir/node_modules/json5" ]; then
    echo "$TAG Copying json5 into plugin (required by gen-config.mjs)..."
    mkdir -p "$dir/node_modules"
    cp -rL /app/node_modules/json5 "$dir/node_modules/json5"
  fi
}

# ---- Detect mode ----
if [ -f "$DEV_MARKER" ]; then
  echo "$TAG Mode: dev (volume mount at $DEV_MOUNT)"
  IKENTIC_PLUGIN_PATH="$DEV_MOUNT"

  # pnpm monorepo hoisting means node_modules may be empty in the mounted dir.
  # Install production deps if json5 (needed by gen-config.mjs) is missing.
  if [ ! -d "$DEV_MOUNT/node_modules/json5" ]; then
    echo "$TAG Installing plugin dependencies (first run)..."
    # Configure npm for @locusai scoped packages on GitHub Packages.
    if [ -n "${NODE_AUTH_TOKEN:-}" ]; then
      NPM_CONFIG_USERCONFIG="/tmp/.npmrc-ikentic"
      cat > "$NPM_CONFIG_USERCONFIG" <<NPMRC
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
@locusai:registry=https://npm.pkg.github.com
NPMRC
      export NPM_CONFIG_USERCONFIG
    fi
    (cd "$DEV_MOUNT" && npm install --omit=dev --ignore-scripts 2>&1) || {
      echo "$TAG Warning: npm install failed; gen-config may fail if deps are missing" >&2
    }
    # Clean up temporary .npmrc
    rm -f "${NPM_CONFIG_USERCONFIG:-}"
    unset NPM_CONFIG_USERCONFIG 2>/dev/null || true
  fi

  export IKENTIC_PLUGIN_PATH

  echo "$TAG Generating IKENTIC config..."
  node "$IKENTIC_PLUGIN_PATH/scripts/gen-config.mjs" \
    --config /home/node/.openclaw/openclaw.json

  echo "$TAG Enabling ikentic plugin..."
  node openclaw.mjs plugins enable ikentic 2>/dev/null || true

elif [ -d "$NPM_CACHE_DIR" ]; then
  echo "$TAG Mode: npm (cached install found at $NPM_CACHE_DIR)"
  IKENTIC_PLUGIN_PATH="$NPM_CACHE_DIR"
  export IKENTIC_PLUGIN_PATH

  ensure_json5 "$IKENTIC_PLUGIN_PATH"

  echo "$TAG Generating IKENTIC config..."
  node "$IKENTIC_PLUGIN_PATH/scripts/gen-config.mjs" \
    --config /home/node/.openclaw/openclaw.json

  # plugins install already enabled the plugin and recorded metadata on first run.

else
  echo "$TAG Mode: npm (installing from registry)"

  IKENTIC_NPM_SPEC="${IKENTIC_NPM_SPEC:-@locusai/openclaw-ikentic-plugin}"

  if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
    echo "$TAG ERROR: NODE_AUTH_TOKEN is required for npm install mode." >&2
    echo "$TAG Set it in .env.ikentic (GitHub PAT with read:packages scope)." >&2
    exit 1
  fi

  # Write a temporary .npmrc for the GitHub Packages registry.
  NPM_CONFIG_USERCONFIG="/tmp/.npmrc-ikentic"
  cat > "$NPM_CONFIG_USERCONFIG" <<NPMRC
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
@locusai:registry=https://npm.pkg.github.com
NPMRC
  export NPM_CONFIG_USERCONFIG

  echo "$TAG Installing $IKENTIC_NPM_SPEC ..."
  node openclaw.mjs plugins install "$IKENTIC_NPM_SPEC"

  # Clean up the temporary .npmrc
  rm -f "$NPM_CONFIG_USERCONFIG"
  unset NPM_CONFIG_USERCONFIG

  IKENTIC_PLUGIN_PATH="$NPM_CACHE_DIR"
  export IKENTIC_PLUGIN_PATH

  ensure_json5 "$IKENTIC_PLUGIN_PATH"

  echo "$TAG Generating IKENTIC config..."
  node "$IKENTIC_PLUGIN_PATH/scripts/gen-config.mjs" \
    --config /home/node/.openclaw/openclaw.json

  # plugins install already enables the plugin and records install metadata.
fi

# ---- Auto-generate gateway token if none provided ----
TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  TOKEN=$(node -e "process.stdout.write(require(\"crypto\").randomBytes(32).toString(\"hex\"))")
  export OPENCLAW_GATEWAY_TOKEN="$TOKEN"
fi

echo ""
echo "============================================================"
echo "  OpenClaw + IKENTIC is ready!"
echo ""
echo "  Open in browser:"
echo "    http://localhost:18789/#token=$TOKEN"
echo "============================================================"
echo ""

exec node openclaw.mjs gateway --allow-unconfigured --bind lan --port 18789
'
