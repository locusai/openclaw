import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../../../config/config.js";
import { writeWorkspaceFile } from "../../../../test-helpers/workspace.js";
import { withEnvAsync } from "../../../../test-utils/env.js";
import { createHookEvent } from "../../../hooks.js";
import { generateSlugViaLLM } from "../../../llm-slug-generator.js";

vi.mock("../../../llm-slug-generator.js", () => ({
  generateSlugViaLLM: vi.fn().mockResolvedValue("override-slug"),
}));

let handler: typeof import("../handler.js").default;
let suiteWorkspaceRoot = "";
let workspaceCaseCounter = 0;

async function createCaseWorkspace(prefix = "case"): Promise<string> {
  const dir = path.join(suiteWorkspaceRoot, `${prefix}-${workspaceCaseCounter}`);
  workspaceCaseCounter += 1;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function createMockSessionContent(entries: Array<{ role: string; content: string }>): string {
  return entries
    .map((entry) =>
      JSON.stringify({
        type: "message",
        message: {
          role: entry.role,
          content: entry.content,
        },
      }),
    )
    .join("\n");
}

beforeAll(async () => {
  ({ default: handler } = await import("../handler.js"));
  suiteWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-session-memory-ike-"));
});

afterAll(async () => {
  if (!suiteWorkspaceRoot) {
    return;
  }
  await fs.rm(suiteWorkspaceRoot, { recursive: true, force: true });
  suiteWorkspaceRoot = "";
  workspaceCaseCounter = 0;
});

describe("IKE carry session memory slug overrides", () => {
  it("uses stored session model overrides for LLM slug generation", async () => {
    const generateSlug = vi.mocked(generateSlugViaLLM);
    generateSlug.mockClear();
    generateSlug.mockResolvedValueOnce("override-slug");
    const tempDir = await createCaseWorkspace("workspace");
    const sessionsDir = path.join(tempDir, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    const sessionFile = await writeWorkspaceFile({
      dir: sessionsDir,
      name: "override-session.jsonl",
      content: createMockSessionContent([
        { role: "user", content: "Need an override slug" },
        { role: "assistant", content: "Use the selected model" },
      ]),
    });

    await withEnvAsync(
      {
        NODE_ENV: "development",
        OPENCLAW_TEST_FAST: undefined,
        VITEST: undefined,
      },
      async () => {
        await handler(
          createHookEvent("command", "new", "agent:main:main", {
            cfg: {
              agents: { defaults: { workspace: tempDir } },
              hooks: { internal: { entries: { "session-memory": { enabled: true } } } },
            } satisfies OpenClawConfig,
            previousSessionEntry: {
              sessionId: "override-session",
              sessionFile,
              providerOverride: "openrouter",
              modelOverride: "kimi-k2",
            },
          }),
        );
      },
    );

    expect(generateSlug).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openrouter",
        model: "kimi-k2",
        sessionContent: expect.stringContaining("Need an override slug"),
      }),
    );
  });
});
