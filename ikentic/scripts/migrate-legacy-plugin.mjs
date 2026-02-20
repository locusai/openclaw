#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const readArg = (name, fallback = "") => {
  const idx = args.indexOf(name);
  if (idx === -1) {
    return fallback;
  }
  const v = args[idx + 1];
  if (!v || v.startsWith("--")) {
    return fallback;
  }
  return v;
};

const logPrefix = readArg("--log-prefix", "[plugin-migrate]");
const configPath = readArg("--config", "/home/node/.openclaw/openclaw.json");
const extensionsDir = readArg("--extensions-dir", "/home/node/.openclaw/extensions");
const legacyId = readArg("--legacy-id", "ikentic");
const targetId = readArg("--target-id", "openclaw-ikentic-plugin");
const targetSpec = readArg("--target-spec", "");
const openclawEntry = readArg("--openclaw-entry", "/app/openclaw.mjs");
const legacyVersion = readArg("--legacy-version", "");

if (!targetSpec) {
  console.error(`${logPrefix} target spec is required (--target-spec)`);
  process.exit(2);
}

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
};

const deepMerge = (base, next) => {
  if (Array.isArray(base) && Array.isArray(next)) {
    return next.slice();
  }
  if (
    base &&
    typeof base === "object" &&
    !Array.isArray(base) &&
    next &&
    typeof next === "object" &&
    !Array.isArray(next)
  ) {
    const out = { ...base };
    for (const [k, v] of Object.entries(next)) {
      out[k] = k in out ? deepMerge(out[k], v) : v;
    }
    return out;
  }
  return next;
};

const targetPluginDir = path.join(extensionsDir, targetId);
const targetManifestPath = path.join(targetPluginDir, "openclaw.plugin.json");
const legacyPluginDir = path.join(extensionsDir, legacyId);
const legacyManifestPath = path.join(legacyPluginDir, "openclaw.plugin.json");

const cfg = readJson(configPath) ?? {};
const entries = cfg?.plugins?.entries ?? {};
const hasLegacyEntry = Boolean(entries && typeof entries === "object" && entries[legacyId]);

const targetManifest = readJson(targetManifestPath);
const legacyManifest = readJson(legacyManifestPath);
const targetLooksLegacy =
  targetManifest?.id === legacyId && (!legacyVersion || targetManifest?.version === legacyVersion);
const legacyDirExists = fs.existsSync(legacyPluginDir) && !!legacyManifest;

const shouldMigrate = hasLegacyEntry || targetLooksLegacy || legacyDirExists;
if (!shouldMigrate) {
  console.log(`${logPrefix} Legacy migration not needed (target=${targetId}, legacy=${legacyId}).`);
  process.exit(0);
}

if (fs.existsSync(configPath)) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${configPath}.legacy-${legacyId}-${ts}.bak`;
  fs.copyFileSync(configPath, backupPath);
  console.log(`${logPrefix} Backed up config to ${backupPath}`);
}

if (!cfg.plugins || typeof cfg.plugins !== "object") {
  cfg.plugins = {};
}
if (!cfg.plugins.entries || typeof cfg.plugins.entries !== "object") {
  cfg.plugins.entries = {};
}
const oldEntry = cfg.plugins.entries[legacyId];
const currentTargetEntry = cfg.plugins.entries[targetId];
if (oldEntry && typeof oldEntry === "object") {
  cfg.plugins.entries[targetId] = deepMerge(currentTargetEntry ?? {}, oldEntry);
  delete cfg.plugins.entries[legacyId];
}
if (Array.isArray(cfg.plugins.allow)) {
  cfg.plugins.allow = Array.from(
    new Set(cfg.plugins.allow.map((id) => (id === legacyId ? targetId : id))),
  );
}
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
console.log(`${logPrefix} Merged legacy config entry ${legacyId} -> ${targetId}`);

if (legacyDirExists) {
  fs.rmSync(legacyPluginDir, { recursive: true, force: true });
  console.log(`${logPrefix} Removed legacy extension dir ${legacyPluginDir}`);
}
if (fs.existsSync(targetPluginDir)) {
  fs.rmSync(targetPluginDir, { recursive: true, force: true });
  console.log(`${logPrefix} Removed stale extension dir ${targetPluginDir}`);
}

const tempConfig = path.join(os.tmpdir(), `openclaw-plugin-migrate-${Date.now()}.json`);
fs.writeFileSync(tempConfig, "{}\n", "utf8");

let tempNpmrc = "";
const env = { ...process.env, OPENCLAW_CONFIG_PATH: tempConfig };
if (!env.NPM_CONFIG_USERCONFIG && env.NODE_AUTH_TOKEN) {
  tempNpmrc = path.join(os.tmpdir(), `.npmrc-plugin-migrate-${process.pid}`);
  fs.writeFileSync(
    tempNpmrc,
    `//npm.pkg.github.com/:_authToken=${env.NODE_AUTH_TOKEN}\n@locusai:registry=https://npm.pkg.github.com\n`,
    "utf8",
  );
  env.NPM_CONFIG_USERCONFIG = tempNpmrc;
}

console.log(`${logPrefix} Installing ${targetSpec} after legacy cleanup...`);
const install = spawnSync("node", [openclawEntry, "plugins", "install", targetSpec], {
  encoding: "utf8",
  env,
});
if (install.stdout) {
  process.stdout.write(install.stdout);
}
if (install.stderr) {
  process.stderr.write(install.stderr);
}

fs.rmSync(tempConfig, { force: true });
if (tempNpmrc) {
  fs.rmSync(tempNpmrc, { force: true });
}

if (install.status !== 0) {
  console.error(`${logPrefix} Failed to install ${targetSpec} during legacy migration.`);
  process.exit(1);
}

console.log(`${logPrefix} Legacy migration completed.`);
