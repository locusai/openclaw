import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveIkenticPluginRoot } from "./ikentic-e2e-fixtures";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

describe("resolveIkenticPluginRoot", () => {
  it("uses the env override when provided", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ikentic-root-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}\n", "utf8");
    const resolved = resolveIkenticPluginRoot(root);
    expect(resolved).toBe(path.resolve(root));
  });

  it("discovers the plugin root from repo-relative candidates", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ikentic-workspace-"));
    const candidate = path.join(workspace, "extensions", "openclaw-ikentic-plugin");
    fs.mkdirSync(candidate, { recursive: true });
    fs.writeFileSync(path.join(candidate, "package.json"), "{}\n", "utf8");

    process.chdir(workspace);
    const resolved = resolveIkenticPluginRoot("");
    expect(fs.realpathSync(resolved)).toBe(fs.realpathSync(path.resolve(candidate)));
  });

  it("throws when no plugin root can be discovered", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ikentic-workspace-empty-"));
    process.chdir(workspace);
    expect(() => resolveIkenticPluginRoot("")).toThrow("IKENTIC plugin root not found");
  });
});
