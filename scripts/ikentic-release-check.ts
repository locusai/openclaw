#!/usr/bin/env -S node --import tsx

/**
 * Ikentic-specific release gate: verify first-party extension versions
 * match the root package version before publish.
 *
 * Kept separate from scripts/release-check.ts (upstream) to avoid
 * merge conflicts during mechanical sync.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

type PackageJson = {
  name?: string;
  version?: string;
};

const firstPartyScopes = ["@openclaw/"];

function normalizeVersion(version: string): string {
  return version.replace(/[-+].*$/, "");
}

function loadRootVersion(): string {
  const rootPkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as PackageJson;
  if (!rootPkg.version) {
    console.error("ikentic-release-check: root package.json missing version.");
    process.exit(1);
  }
  return rootPkg.version;
}

function readExtensionPkg(extensionsDir: string, dirName: string): PackageJson | null {
  try {
    return JSON.parse(
      readFileSync(join(extensionsDir, dirName, "package.json"), "utf8"),
    ) as PackageJson;
  } catch {
    return null;
  }
}

function findMismatches(targetBase: string): string[] {
  const extensionsDir = resolve("extensions");
  const dirs = readdirSync(extensionsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const mismatches: string[] = [];

  for (const dir of dirs) {
    const pkg = readExtensionPkg(extensionsDir, dir.name);
    if (!pkg?.name || !pkg.version) {
      continue;
    }

    const isFirstParty = firstPartyScopes.some((s) => pkg.name?.startsWith(s));
    if (!isFirstParty) {
      continue;
    }

    if (normalizeVersion(pkg.version) !== targetBase) {
      mismatches.push(`${pkg.name} (${pkg.version})`);
    }
  }
  return mismatches;
}

function main() {
  const targetVersion = loadRootVersion();
  const targetBase = normalizeVersion(targetVersion);
  const mismatches = findMismatches(targetBase);

  if (mismatches.length > 0) {
    console.error(
      `ikentic-release-check: first-party plugin versions must match base ${targetBase} (root ${targetVersion}):`,
    );
    for (const m of mismatches) {
      console.error(`  - ${m}`);
    }
    console.error("Run `pnpm plugins:sync:ikentic` to align plugin versions.");
    process.exit(1);
  }

  console.log("ikentic-release-check: first-party plugin versions OK.");
}

main();
