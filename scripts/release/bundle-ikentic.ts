#!/usr/bin/env -S node --import tsx

import fs from "node:fs/promises";
import path from "node:path";
import { installPluginFromNpmSpec } from "../../src/plugins/install.js";

const IKENTIC_PLUGIN_ID = "openclaw-ikentic-plugin";
const DEFAULT_IKENTIC_BUNDLE_SPEC = "@locusai/openclaw-ikentic-plugin@0.1.0-test.20260217.1";

function fail(message: string): never {
  console.error(`bundle:ikentic: ${message}`);
  process.exit(1);
}

async function main() {
  const spec = process.env.IKENTIC_BUNDLE_SPEC?.trim() || DEFAULT_IKENTIC_BUNDLE_SPEC;
  if (!process.env.IKENTIC_BUNDLE_SPEC?.trim()) {
    console.warn(
      `bundle:ikentic: IKENTIC_BUNDLE_SPEC is unset; using fallback ${DEFAULT_IKENTIC_BUNDLE_SPEC}`,
    );
  }

  const repoRoot = process.cwd();
  const extensionsDir = path.resolve(repoRoot, "extensions");
  const expectedTargetDir = path.resolve(extensionsDir, IKENTIC_PLUGIN_ID);
  const repoNpmrc = path.resolve(repoRoot, ".npmrc");

  if (!process.env.NPM_CONFIG_USERCONFIG) {
    try {
      await fs.access(repoNpmrc);
      process.env.NPM_CONFIG_USERCONFIG = repoNpmrc;
      console.log(`bundle:ikentic: using NPM_CONFIG_USERCONFIG=${repoNpmrc}`);
    } catch {
      // No repo .npmrc found; rely on caller-provided npm config.
    }
  }

  console.log(`bundle:ikentic: bundling ${spec} into ${expectedTargetDir}`);
  const result = await installPluginFromNpmSpec({
    spec,
    extensionsDir,
    expectedPluginId: IKENTIC_PLUGIN_ID,
    mode: "update",
    logger: {
      info: (message) => console.log(`bundle:ikentic: ${message}`),
      warn: (message) => console.warn(`bundle:ikentic: ${message}`),
    },
  });

  if (!result.ok) {
    fail(result.error);
  }

  const actualTargetDir = path.resolve(result.targetDir);
  if (actualTargetDir !== expectedTargetDir) {
    fail(`unexpected install path: expected ${expectedTargetDir}, got ${actualTargetDir}`);
  }

  if (result.pluginId !== IKENTIC_PLUGIN_ID) {
    fail(`unexpected plugin id: expected ${IKENTIC_PLUGIN_ID}, got ${result.pluginId}`);
  }

  console.log(
    `bundle:ikentic: bundled ${result.manifestName ?? result.pluginId}@${result.version ?? "unknown"}`,
  );
}

await main();
