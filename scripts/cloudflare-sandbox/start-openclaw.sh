#!/usr/bin/env bash
set -euo pipefail

# Cloudflare Sandbox startup script for OpenClaw.
# Responsibilities:
# 1) Restore config/workspace/skills from R2 via rclone (if configured)
# 2) Run `openclaw onboard --non-interactive` only when config is missing
# 3) Patch config for sandbox-only wiring (gateway auth, trusted proxies, channels)
# 4) Run IKENTIC init when enabled (no gateway start in init)
# 5) Start background sync loop + gateway

if pgrep -f "openclaw gateway" >/dev/null 2>&1; then
  echo "OpenClaw gateway is already running, exiting."
  exit 0
fi

OPENCLAW_CONFIG_DIR="${OPENCLAW_CONFIG_DIR:-/root/.openclaw}"
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-${OPENCLAW_CONFIG_DIR}/openclaw.json}"
OPENCLAW_WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/root/clawd}"
OPENCLAW_SKILLS_DIR="${OPENCLAW_SKILLS_DIR:-${OPENCLAW_WORKSPACE_DIR}/skills}"
OPENCLAW_RCLONE_CONF="${OPENCLAW_RCLONE_CONF:-/root/.config/rclone/rclone.conf}"
OPENCLAW_LAST_SYNC_FILE="${OPENCLAW_LAST_SYNC_FILE:-/tmp/.last-sync}"
OPENCLAW_GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"

mkdir -p "$OPENCLAW_CONFIG_DIR"

r2_configured() {
  [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ] && [ -n "${CF_ACCOUNT_ID:-}" ]
}

R2_BUCKET="${R2_BUCKET_NAME:-moltbot-data}"
RCLONE_FLAGS="--transfers=16 --fast-list --s3-no-check-bucket"

setup_rclone() {
  mkdir -p "$(dirname "$OPENCLAW_RCLONE_CONF")"
  cat >"$OPENCLAW_RCLONE_CONF" <<EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = ${R2_ACCESS_KEY_ID}
secret_access_key = ${R2_SECRET_ACCESS_KEY}
endpoint = https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
EOF
  touch /tmp/.rclone-configured
  echo "Rclone configured for bucket: ${R2_BUCKET}"
}

restore_from_r2() {
  setup_rclone

  echo "Checking R2 for existing backup..."
  if rclone ls "r2:${R2_BUCKET}/openclaw/openclaw.json" $RCLONE_FLAGS 2>/dev/null | grep -q openclaw.json; then
    echo "Restoring config from R2..."
    rclone copy "r2:${R2_BUCKET}/openclaw/" "$OPENCLAW_CONFIG_DIR/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: config restore failed with exit code $?"
    echo "Config restored"
  elif rclone ls "r2:${R2_BUCKET}/clawdbot/clawdbot.json" $RCLONE_FLAGS 2>/dev/null | grep -q clawdbot.json; then
    echo "Restoring from legacy R2 backup..."
    rclone copy "r2:${R2_BUCKET}/clawdbot/" "$OPENCLAW_CONFIG_DIR/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: legacy config restore failed with exit code $?"
    if [ -f "$OPENCLAW_CONFIG_DIR/clawdbot.json" ] && [ ! -f "$OPENCLAW_CONFIG_PATH" ]; then
      mv "$OPENCLAW_CONFIG_DIR/clawdbot.json" "$OPENCLAW_CONFIG_PATH"
    fi
    echo "Legacy config restored and migrated"
  else
    echo "No backup found in R2, starting fresh"
  fi

  local remote_ws_count
  remote_ws_count="$(rclone ls "r2:${R2_BUCKET}/workspace/" $RCLONE_FLAGS 2>/dev/null | wc -l)"
  if [ "${remote_ws_count}" -gt 0 ]; then
    echo "Restoring workspace from R2 (${remote_ws_count} files)..."
    mkdir -p "$OPENCLAW_WORKSPACE_DIR"
    rclone copy "r2:${R2_BUCKET}/workspace/" "$OPENCLAW_WORKSPACE_DIR/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: workspace restore failed with exit code $?"
    echo "Workspace restored"
  fi

  local remote_sk_count
  remote_sk_count="$(rclone ls "r2:${R2_BUCKET}/skills/" $RCLONE_FLAGS 2>/dev/null | wc -l)"
  if [ "${remote_sk_count}" -gt 0 ]; then
    echo "Restoring skills from R2 (${remote_sk_count} files)..."
    mkdir -p "$OPENCLAW_SKILLS_DIR"
    rclone copy "r2:${R2_BUCKET}/skills/" "$OPENCLAW_SKILLS_DIR/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: skills restore failed with exit code $?"
    echo "Skills restored"
  fi
}

if r2_configured; then
  restore_from_r2
else
  echo "R2 not configured, starting fresh"
fi

if [ ! -f "$OPENCLAW_CONFIG_PATH" ]; then
  echo "No existing config found, running openclaw onboard..."

  auth_args=()
  if [ -n "${CLOUDFLARE_AI_GATEWAY_API_KEY:-}" ] && [ -n "${CF_AI_GATEWAY_ACCOUNT_ID:-}" ] && [ -n "${CF_AI_GATEWAY_GATEWAY_ID:-}" ]; then
    auth_args+=(--auth-choice cloudflare-ai-gateway-api-key)
    auth_args+=(--cloudflare-ai-gateway-account-id "$CF_AI_GATEWAY_ACCOUNT_ID")
    auth_args+=(--cloudflare-ai-gateway-gateway-id "$CF_AI_GATEWAY_GATEWAY_ID")
    auth_args+=(--cloudflare-ai-gateway-api-key "$CLOUDFLARE_AI_GATEWAY_API_KEY")
  elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    auth_args+=(--auth-choice apiKey --anthropic-api-key "$ANTHROPIC_API_KEY")
  elif [ -n "${OPENAI_API_KEY:-}" ]; then
    auth_args+=(--auth-choice openai-api-key --openai-api-key "$OPENAI_API_KEY")
  fi

  openclaw onboard --non-interactive --accept-risk \
    --mode local \
    "${auth_args[@]}" \
    --gateway-port "$OPENCLAW_GATEWAY_PORT" \
    --gateway-bind lan \
    --skip-channels \
    --skip-skills \
    --skip-health

  echo "Onboard completed"
else
  echo "Using existing config"
fi

export OPENCLAW_CONFIG_PATH

node <<'EOFPATCH'
const fs = require("fs");
const JSON5 = require("json5");

const configPath = process.env.OPENCLAW_CONFIG_PATH;
console.log("Patching config at:", configPath);

let config = {};
try {
  config = JSON5.parse(fs.readFileSync(configPath, "utf8"));
} catch {
  console.log("Starting with empty config");
}

config.gateway = config.gateway || {};
config.channels = config.channels || {};

const port = Number.parseInt(process.env.OPENCLAW_GATEWAY_PORT || "18789", 10);
config.gateway.port = Number.isFinite(port) ? port : 18789;
config.gateway.mode = "local";
config.gateway.trustedProxies = ["10.1.0.0"];

if (process.env.OPENCLAW_GATEWAY_TOKEN) {
  config.gateway.auth = config.gateway.auth || {};
  config.gateway.auth.token = process.env.OPENCLAW_GATEWAY_TOKEN;
}

if (process.env.OPENCLAW_DEV_MODE === "true") {
  config.gateway.controlUi = config.gateway.controlUi || {};
  config.gateway.controlUi.allowInsecureAuth = true;
}

if (process.env.TELEGRAM_BOT_TOKEN) {
  config.channels.telegram = config.channels.telegram || {};
  config.channels.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
  config.channels.telegram.enabled = true;
  const telegramDmPolicy = process.env.TELEGRAM_DM_POLICY || "pairing";
  config.channels.telegram.dmPolicy = telegramDmPolicy;
  if (process.env.TELEGRAM_DM_ALLOW_FROM) {
    config.channels.telegram.allowFrom = process.env.TELEGRAM_DM_ALLOW_FROM.split(",");
  } else if (telegramDmPolicy === "open") {
    config.channels.telegram.allowFrom = ["*"];
  }
}

if (process.env.DISCORD_BOT_TOKEN) {
  config.channels.discord = config.channels.discord || {};
  config.channels.discord.token = process.env.DISCORD_BOT_TOKEN;
  config.channels.discord.enabled = true;
  const discordDmPolicy = process.env.DISCORD_DM_POLICY || "pairing";
  config.channels.discord.dm = config.channels.discord.dm || {};
  config.channels.discord.dm.policy = discordDmPolicy;
  if (discordDmPolicy === "open") {
    config.channels.discord.dm.allowFrom = ["*"];
  }
}

if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
  config.channels.slack = config.channels.slack || {};
  config.channels.slack.botToken = process.env.SLACK_BOT_TOKEN;
  config.channels.slack.appToken = process.env.SLACK_APP_TOKEN;
  config.channels.slack.enabled = true;
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
EOFPATCH

if [ "${IKENTIC_ENABLED:-}" = "true" ]; then
  OPENCLAW_ROOT="/app" IKENTIC_ENABLED="true" /usr/local/lib/openclaw/ikentic-init.sh
fi

background_sync() {
  if ! r2_configured; then
    return 0
  fi

  mkdir -p "$(dirname "$OPENCLAW_LAST_SYNC_FILE")"
  while true; do
    echo "Starting background sync to R2..."
    rclone copy "$OPENCLAW_CONFIG_DIR/" "r2:${R2_BUCKET}/openclaw/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: config sync failed with exit code $?"
    rclone copy "$OPENCLAW_WORKSPACE_DIR/" "r2:${R2_BUCKET}/workspace/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: workspace sync failed with exit code $?"
    rclone copy "$OPENCLAW_SKILLS_DIR/" "r2:${R2_BUCKET}/skills/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: skills sync failed with exit code $?"
    date +%s >"$OPENCLAW_LAST_SYNC_FILE" || true
    sleep "${R2_SYNC_INTERVAL_SECONDS:-300}"
  done
}

background_sync &

echo "Starting OpenClaw gateway..."
exec openclaw gateway --allow-unconfigured --bind lan --port "$OPENCLAW_GATEWAY_PORT"

