#!/usr/bin/env bash
# docker-ikentic-entrypoint.sh — Dual-mode IKENTIC plugin init for Docker.
#
# Mode detection:
#   1. Volume mount (dev): $IKENTIC_DEV_MOUNT_PATH/openclaw.plugin.json exists
#   2. NPM cached:         ~/.openclaw/extensions/openclaw-ikentic-plugin/ exists
#   3. NPM install:        runs `plugins install` (requires /run/secrets/node_auth_token)
#
# Expected to run as root (user: "0" in compose); drops to `node` via runuser.
set -euo pipefail

TAG="[ikentic-init]"

# --- Phase 1: root — fix volume ownership ------------------------------------
mkdir -p /home/node/.openclaw
chown node:node /home/node/.openclaw

# --- Phase 2: node — detect mode, install/link plugin, start gateway ---------
exec runuser -u node -- bash -c '
set -euo pipefail

TAG="[ikentic-init]"
cd /app

EXTENSIONS_DIR="/home/node/.openclaw/extensions"
NPM_CACHE_DIR="$EXTENSIONS_DIR/openclaw-ikentic-plugin"
IKENTIC_PLUGIN_ID_DEFAULT="openclaw-ikentic-plugin"
IKENTIC_PLUGIN_ID="$IKENTIC_PLUGIN_ID_DEFAULT"
DEV_MOUNT_DEFAULT="$EXTENSIONS_DIR/$IKENTIC_PLUGIN_ID_DEFAULT"
DEV_MOUNT="${IKENTIC_DEV_MOUNT_PATH:-$DEV_MOUNT_DEFAULT}"
DEV_MARKER="$DEV_MOUNT/openclaw.plugin.json"
DEV_MODE_REQUESTED="${IKENTIC_DEV_MOUNT_MODE:-}"
IKENTIC_NPM_SPEC_RAW="${IKENTIC_NPM_SPEC:-}"
IKENTIC_NPM_STREAM="${IKENTIC_NPM_STREAM:-}"
NODE_AUTH_TOKEN_FILE="${NODE_AUTH_TOKEN_FILE:-/run/secrets/node_auth_token}"

# Runtime token is secret-file-only in container mode.
unset NODE_AUTH_TOKEN 2>/dev/null || true

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

resolve_plugin_id_from_path() {
  local plugin_dir="$1"
  local plugin_json="$plugin_dir/openclaw.plugin.json"
  local resolved=""

  if [ ! -f "$plugin_json" ]; then
    return 0
  fi

  resolved="$(
    node -e "
      const fs = require(\"node:fs\");
      const p = process.argv[1];
      try {
        const raw = fs.readFileSync(p, \"utf8\");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.id === \"string\" && parsed.id.trim()) {
          process.stdout.write(parsed.id.trim());
        }
      } catch {}
    " "$plugin_json"
  )"

  if [ -n "$resolved" ]; then
    IKENTIC_PLUGIN_ID="$resolved"
  fi
}

resolve_npm_spec() {
  if [ -n "$IKENTIC_NPM_SPEC_RAW" ]; then
    echo "$IKENTIC_NPM_SPEC_RAW"
    return
  fi

  case "$IKENTIC_NPM_STREAM" in
    "")
      echo "@locusai/openclaw-ikentic-plugin"
      ;;
    stable)
      echo "@locusai/openclaw-ikentic-plugin@latest"
      ;;
    dev|beta|rc)
      echo "@locusai/openclaw-ikentic-plugin@$IKENTIC_NPM_STREAM"
      ;;
    *)
      echo "$TAG Warning: unknown IKENTIC_NPM_STREAM \"$IKENTIC_NPM_STREAM\"; expected dev|beta|rc|stable." >&2
      echo "@locusai/openclaw-ikentic-plugin@latest"
      ;;
  esac
}

load_node_auth_token() {
  if [ ! -f "$NODE_AUTH_TOKEN_FILE" ]; then
    return 1
  fi

  NODE_AUTH_TOKEN="$(
    node -e "
      const fs = require(\"node:fs\");
      const p = process.argv[1];
      try {
        const raw = fs.readFileSync(p, \"utf8\");
        const token = raw.trim();
        if (token) process.stdout.write(token);
      } catch {}
    " "$NODE_AUTH_TOKEN_FILE"
  )"

  if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
    return 1
  fi

  export NODE_AUTH_TOKEN
  return 0
}

read_plugin_version_from_path() {
  local plugin_dir="$1"
  local package_json="$plugin_dir/package.json"
  local plugin_json="$plugin_dir/openclaw.plugin.json"
  if [ ! -f "$package_json" ] && [ ! -f "$plugin_json" ]; then
    return 0
  fi

  node -e "
    const fs = require(\"node:fs\");
    const packagePath = process.argv[1];
    const pluginPath = process.argv[2];

    const readVersion = (p) => {
      if (!p || !fs.existsSync(p)) return \"\";
      try {
        const raw = fs.readFileSync(p, \"utf8\");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.version === \"string\" && parsed.version.trim()) {
          return parsed.version.trim();
        }
      } catch {}
      return \"\";
    };

    const packageVersion = readVersion(packagePath);
    if (packageVersion) {
      process.stdout.write(packageVersion);
      process.exit(0);
    }

    const pluginVersion = readVersion(pluginPath);
    if (pluginVersion) {
      process.stdout.write(pluginVersion);
    }
  " "$package_json" "$plugin_json"
}

evaluate_refresh_decision() {
  local installed_version="$1"
  local requested_spec="$2"
  local previous_requested_spec="$3"
  local resolved_target_version="$4"

  node /app/ikentic/scripts/npm-refresh-policy.mjs \
    --installed-version "$installed_version" \
    --requested-spec "$requested_spec" \
    --previous-requested-spec "$previous_requested_spec" \
    --resolved-target-version "$resolved_target_version"
}

read_refresh_decision_field() {
  local decision_json="$1"
  local field="$2"

  node -e "
    const raw = process.argv[1];
    const field = process.argv[2];
    try {
      const parsed = JSON.parse(raw);
      const value = parsed?.[field];
      if (value === undefined || value === null) process.exit(0);
      process.stdout.write(String(value));
    } catch {}
  " "$decision_json" "$field"
}

read_recorded_install_spec_from_config() {
  local config_path="/home/node/.openclaw/openclaw.json"
  if [ ! -f "$config_path" ]; then
    return 0
  fi

  node -e "
    const fs = require(\"node:fs\");
    const p = process.argv[1];
    const pluginId = process.argv[2];
    try {
      const raw = fs.readFileSync(p, \"utf8\");
      const cfg = JSON.parse(raw || \"{}\") || {};
      const spec = cfg?.plugins?.installs?.[pluginId]?.spec;
      if (typeof spec === \"string\" && spec.trim()) {
        process.stdout.write(spec.trim());
      }
    } catch {}
  " "$config_path" "$IKENTIC_PLUGIN_ID_DEFAULT"
}

split_npm_spec() {
  local spec="$1"
  node -e "
    const spec = process.argv[1];
    const match = spec.match(/^(@[^/]+\\/[^@]+|[^@]+)(?:@(.+))?$/);
    if (!match) process.exit(1);
    process.stdout.write((match[1] || \"\") + '\\n' + (match[2] || \"\") + '\\n');
  " "$spec"
}

resolve_registry_version_for_spec() {
  local package_name="$1"
  local selector="$2"
  local npmrc_path=""
  local selector_to_query="$selector"

  if [ -z "$selector_to_query" ]; then
    selector_to_query="latest"
  fi
  if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
    return 1
  fi

  npmrc_path="/tmp/.npmrc-ikentic-resolve-$$"
  cat > "$npmrc_path" <<NPMRC
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
@locusai:registry=https://npm.pkg.github.com
NPMRC

  NPM_CONFIG_USERCONFIG="$npmrc_path" \
    npm view --registry=https://npm.pkg.github.com "${package_name}@${selector_to_query}" version --json 2>/tmp/ikentic-npm-view.err \
    | node -e "
      const fs = require(\"node:fs\");
      const raw = fs.readFileSync(0, \"utf8\").trim();
      if (!raw) process.exit(1);
      let parsed = raw;
      try { parsed = JSON.parse(raw); } catch {}
      let version = parsed;
      if (Array.isArray(version)) version = version[version.length - 1];
      if (typeof version !== \"string\" || !version.trim()) process.exit(1);
      process.stdout.write(version.trim());
    " 2>/dev/null || {
      rm -f "$npmrc_path"
      rm -f /tmp/ikentic-npm-view.err
      return 1
    }

  rm -f "$npmrc_path"
  rm -f /tmp/ikentic-npm-view.err
}

IKENTIC_NPM_REFRESH_REASON=""
should_refresh_cached_npm_plugin() {
  local requested_spec="$1"
  local installed_dir="$2"
  local installed_version=""
  local recorded_spec=""
  local spec_name=""
  local spec_selector=""
  local expected_version=""
  local parts=()
  local decision_json=""
  local decision_refresh=""

  IKENTIC_NPM_REFRESH_REASON=""
  installed_version="$(read_plugin_version_from_path "$installed_dir")"

  recorded_spec="$(read_recorded_install_spec_from_config)"

  mapfile -t parts < <(split_npm_spec "$requested_spec" 2>/dev/null || true)
  spec_name="${parts[0]:-}"
  spec_selector="${parts[1]:-}"
  if [ -n "$spec_name" ]; then
    case "$spec_selector" in
      "")
        expected_version="$(resolve_registry_version_for_spec "$spec_name" "latest" || true)"
        ;;
      latest|dev|beta|rc)
        expected_version="$(resolve_registry_version_for_spec "$spec_name" "$spec_selector" || true)"
        ;;
      *)
        expected_version="$spec_selector"
        ;;
    esac
  fi

  decision_json="$(
    evaluate_refresh_decision \
      "$installed_version" \
      "$requested_spec" \
      "$recorded_spec" \
      "$expected_version"
  )"
  IKENTIC_NPM_REFRESH_REASON="$(read_refresh_decision_field "$decision_json" "reason")"
  decision_refresh="$(read_refresh_decision_field "$decision_json" "refresh")"

  [ "$decision_refresh" = "true" ]
}

install_npm_plugin() {
  local spec="$1"
  local install_out=""
  local existing_dir=""
  local reinstall_out=""
  local install_config="/tmp/openclaw-ikentic-install-config.json"

  if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
    echo "$TAG ERROR: /run/secrets/node_auth_token is required for npm install mode." >&2
    echo "$TAG Set host NODE_AUTH_TOKEN so compose can mount runtime secret node_auth_token." >&2
    return 1
  fi

  # Write a temporary .npmrc for the GitHub Packages registry.
  NPM_CONFIG_USERCONFIG="/tmp/.npmrc-ikentic"
  cat > "$NPM_CONFIG_USERCONFIG" <<NPMRC
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
@locusai:registry=https://npm.pkg.github.com
NPMRC
  export NPM_CONFIG_USERCONFIG

  # Install/update must not depend on the live config being valid.
  # Use an isolated temporary config so stale plugin entries in
  # /home/node/.openclaw/openclaw.json cannot block refresh.
  printf "{}\n" > "$install_config"

  echo "$TAG Installing $spec ..."
  if ! install_out="$(OPENCLAW_CONFIG_PATH="$install_config" node openclaw.mjs plugins install "$spec" 2>&1)"; then
    echo "$install_out"
    if printf "%s" "$install_out" | grep -q "plugin already exists:"; then
      existing_dir="$(
        printf "%s\n" "$install_out" \
          | sed -n "s|.*plugin already exists: \\(.*\\) (delete it first).*|\\1|p" \
          | tail -n 1
      )"
      if [ -n "$existing_dir" ]; then
        resolve_plugin_id_from_path "$existing_dir"
        if [ -z "${IKENTIC_PLUGIN_ID:-}" ]; then
          IKENTIC_PLUGIN_ID="$(basename "$existing_dir")"
        fi
      fi
      if [ -z "$existing_dir" ]; then
        existing_dir="$NPM_CACHE_DIR"
      fi
      echo "$TAG Plugin already installed; replacing cached plugin at $existing_dir ..."
      rm -rf "$existing_dir"
      if ! reinstall_out="$(OPENCLAW_CONFIG_PATH="$install_config" node openclaw.mjs plugins install "$spec" 2>&1)"; then
        echo "$reinstall_out"
        rm -f "$NPM_CONFIG_USERCONFIG"
        rm -f "$install_config"
        unset NPM_CONFIG_USERCONFIG 2>/dev/null || true
        return 1
      fi
      echo "$reinstall_out"
      rm -f "$NPM_CONFIG_USERCONFIG"
      rm -f "$install_config"
      unset NPM_CONFIG_USERCONFIG 2>/dev/null || true
      return 0
    fi
    rm -f "$NPM_CONFIG_USERCONFIG"
    rm -f "$install_config"
    unset NPM_CONFIG_USERCONFIG 2>/dev/null || true
    return 1
  fi
  echo "$install_out"

  # Clean up the temporary .npmrc
  rm -f "$NPM_CONFIG_USERCONFIG"
  rm -f "$install_config"
  unset NPM_CONFIG_USERCONFIG 2>/dev/null || true
}

sanitize_legacy_plugin_refs() {
  local config_path="/home/node/.openclaw/openclaw.json"
  if [ ! -f "$config_path" ]; then
    return 0
  fi

  node -e "
    const fs = require(\"node:fs\");
    const p = process.argv[1];
    const legacyId = process.argv[2];
    const targetId = process.argv[3];
    let changed = false;

    let cfg = {};
    try {
      cfg = JSON.parse(fs.readFileSync(p, \"utf8\") || \"{}\") || {};
    } catch {
      process.exit(0);
    }
    if (!cfg.plugins || typeof cfg.plugins !== \"object\") cfg.plugins = {};
    if (!cfg.plugins.entries || typeof cfg.plugins.entries !== \"object\") {
      cfg.plugins.entries = {};
    }

    const entries = cfg.plugins.entries;
    const legacyEntry = entries[legacyId];
    if (legacyEntry && !entries[targetId]) {
      entries[targetId] = legacyEntry;
      changed = true;
    }
    if (legacyEntry) {
      delete entries[legacyId];
      changed = true;
    }

    if (Array.isArray(cfg.plugins.allow)) {
      const normalized = [];
      for (const id of cfg.plugins.allow) {
        if (typeof id !== \"string\") continue;
        const mapped = id === legacyId ? targetId : id;
        if (!normalized.includes(mapped)) normalized.push(mapped);
      }
      if (normalized.join(\",\") !== cfg.plugins.allow.join(\",\")) {
        cfg.plugins.allow = normalized;
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\\n', \"utf8\");
      process.stdout.write(\"sanitized\");
    }
  " "$config_path" "${IKENTIC_LEGACY_PLUGIN_ID:-ikentic}" "$IKENTIC_PLUGIN_ID_DEFAULT" >/tmp/ikentic-sanitize.out 2>/dev/null || true

  if [ "$(cat /tmp/ikentic-sanitize.out 2>/dev/null || true)" = "sanitized" ]; then
    echo "$TAG Sanitized legacy plugin references in openclaw.json"
  fi
  rm -f /tmp/ikentic-sanitize.out
}

generate_ikentic_config() {
  echo "$TAG Generating IKENTIC config..."
  IKENTIC_ENABLED="true" \
    OPENCLAW_ROOT="/app" \
    OPENCLAW_CONFIG_PATH="/home/node/.openclaw/openclaw.json" \
    IKENTIC_PLUGIN_PATH="$IKENTIC_PLUGIN_PATH" \
    IKENTIC_PLUGIN_ID="$IKENTIC_PLUGIN_ID" \
    bash /app/scripts/cloudflare-sandbox/ikentic-init.sh
  sanitize_legacy_plugin_refs
}

IKENTIC_NPM_SPEC="$(resolve_npm_spec)"
load_node_auth_token >/dev/null 2>&1 || true
IKENTIC_NPM_REFRESH="false"
if [ -n "$IKENTIC_NPM_SPEC_RAW" ] || [ -n "$IKENTIC_NPM_STREAM" ]; then
  IKENTIC_NPM_REFRESH="true"
fi

DEV_MODE_ACTIVE="false"
if [ -n "$DEV_MODE_REQUESTED" ] && [ -f "$DEV_MARKER" ]; then
  DEV_MODE_ACTIVE="true"
elif [ -n "$DEV_MODE_REQUESTED" ]; then
  echo "$TAG Warning: IKENTIC_DEV_MOUNT_MODE is set but marker is missing at $DEV_MARKER; falling back to npm mode." >&2
fi

# One-time legacy migration before any OpenClaw plugin commands.
MIGRATE_ARGS=()
if [ -n "${IKENTIC_LEGACY_VERSION:-}" ]; then
  MIGRATE_ARGS=(--legacy-version "$IKENTIC_LEGACY_VERSION")
fi

MIGRATION_PERFORMED="false"
if [ "$DEV_MODE_ACTIVE" = "true" ]; then
  echo "$TAG Dev mode detected at $DEV_MOUNT; skipping legacy npm migration."
else
  MIGRATION_OUT="$(
    node /app/ikentic/scripts/migrate-legacy-plugin.mjs \
      --log-prefix "$TAG" \
      --config /home/node/.openclaw/openclaw.json \
      --extensions-dir "$EXTENSIONS_DIR" \
      --legacy-id "${IKENTIC_LEGACY_PLUGIN_ID:-ikentic}" \
      --target-id "$IKENTIC_PLUGIN_ID_DEFAULT" \
      --target-spec "$IKENTIC_NPM_SPEC" \
      --openclaw-entry /app/openclaw.mjs \
      "${MIGRATE_ARGS[@]}"
  )"
  echo "$MIGRATION_OUT"
  if printf "%s" "$MIGRATION_OUT" | grep -q "Legacy migration completed."; then
    MIGRATION_PERFORMED="true"
    IKENTIC_NPM_REFRESH="false"
  fi
fi

# ---- Detect mode ----
if [ "$DEV_MODE_ACTIVE" = "true" ]; then
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
  resolve_plugin_id_from_path "$IKENTIC_PLUGIN_PATH"

  generate_ikentic_config

elif [ -d "$NPM_CACHE_DIR" ]; then
  echo "$TAG Mode: npm (cached install found at $NPM_CACHE_DIR)"
  IKENTIC_PLUGIN_PATH="$NPM_CACHE_DIR"
  export IKENTIC_PLUGIN_PATH
  resolve_plugin_id_from_path "$IKENTIC_PLUGIN_PATH"

  if [ "$IKENTIC_NPM_REFRESH" = "true" ] && [ "$MIGRATION_PERFORMED" != "true" ]; then
    if should_refresh_cached_npm_plugin "$IKENTIC_NPM_SPEC" "$IKENTIC_PLUGIN_PATH"; then
      if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
        echo "$TAG Warning: refresh needed ($IKENTIC_NPM_REFRESH_REASON) but /run/secrets/node_auth_token is missing; keeping cached plugin." >&2
      else
        echo "$TAG Refreshing IKENTIC plugin from $IKENTIC_NPM_SPEC ($IKENTIC_NPM_REFRESH_REASON) ..."
        if install_npm_plugin "$IKENTIC_NPM_SPEC"; then
          resolve_plugin_id_from_path "$IKENTIC_PLUGIN_PATH"
        else
          echo "$TAG Warning: failed to refresh IKENTIC plugin; using cached version." >&2
        fi
      fi
    else
      echo "$TAG IKENTIC plugin is current; skipping refresh."
    fi
  fi

  ensure_json5 "$IKENTIC_PLUGIN_PATH"
  generate_ikentic_config

  # plugins install already enabled the plugin and recorded metadata on first run.

else
  echo "$TAG Mode: npm (installing from registry)"

  install_npm_plugin "$IKENTIC_NPM_SPEC"

  IKENTIC_PLUGIN_PATH="$NPM_CACHE_DIR"
  export IKENTIC_PLUGIN_PATH
  resolve_plugin_id_from_path "$IKENTIC_PLUGIN_PATH"

  ensure_json5 "$IKENTIC_PLUGIN_PATH"
  generate_ikentic_config

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
