/* @vitest-environment jsdom */

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatHost } from "../app-chat.ts";

const { setLastActiveSessionKeyMock } = vi.hoisted(() => ({
  setLastActiveSessionKeyMock: vi.fn(),
}));

vi.mock("../app-last-active-session.ts", () => ({
  setLastActiveSessionKey: (...args: unknown[]) => setLastActiveSessionKeyMock(...args),
}));

type ChatHarnessHost = ChatHost & {
  chatStreamSegments: Array<{ text: string; ts: number }>;
  chatToolMessages: Record<string, unknown>[];
  toolStreamById: Map<string, unknown>;
  toolStreamOrder: string[];
  toolStreamSyncTimer: number | null;
};

let handleSendChat: typeof import("../app-chat.ts").handleSendChat;

async function loadChatHelpers(): Promise<void> {
  ({ handleSendChat } = await import("../app-chat.ts"));
}

function makeHost(overrides?: Partial<ChatHarnessHost>): ChatHarnessHost {
  return {
    client: null,
    chatLoading: false,
    chatMessages: [],
    chatStream: null,
    chatStreamSegments: [],
    connected: true,
    chatMessage: "",
    chatLocalInputHistoryBySession: {},
    chatInputHistorySessionKey: null,
    chatInputHistoryItems: null,
    chatInputHistoryIndex: -1,
    chatDraftBeforeHistory: null,
    chatAttachments: [],
    chatQueue: [],
    chatRunId: null,
    chatSending: false,
    lastError: null,
    sessionKey: "agent:main",
    basePath: "",
    hello: null,
    chatAvatarUrl: null,
    chatSideResult: null,
    chatSideResultTerminalRuns: new Set<string>(),
    chatToolMessages: [],
    chatModelOverrides: {},
    chatModelsLoading: false,
    chatModelCatalog: [],
    toolStreamById: new Map(),
    toolStreamOrder: [],
    toolStreamSyncTimer: null,
    refreshSessionsAfterChat: new Set<string>(),
    updateComplete: Promise.resolve(),
    ...overrides,
  };
}

describe("IKE carry web chat command options", () => {
  beforeAll(async () => {
    await loadChatHelpers();
  });

  it.each([
    { command: "/new --persona finance", expectedMessage: "/new --persona finance" },
    { command: "/reset --persona finance", expectedMessage: "/reset --persona finance" },
  ])("preserves command args for $command", async ({ command, expectedMessage }) => {
    const request = vi.fn(async (...args: unknown[]) => {
      const method = String(args[0]);
      if (method === "chat.send") {
        return { status: "started", runId: "run-reset" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: command,
    });

    await handleSendChat(host);

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        sessionKey: "agent:main",
        message: expectedMessage,
        deliver: false,
        idempotencyKey: expect.any(String),
      }),
    );
    const sentParams = request.mock.calls[0]?.[1] as { idempotencyKey?: string } | undefined;
    expect(host.refreshSessionsAfterChat).toContain(sentParams?.idempotencyKey);
    expect(host.chatMessage).toBe("");
  });

  it("routes bare /new through the fresh-session action", async () => {
    const onSlashAction = vi.fn();
    const request = vi.fn(async (...args: unknown[]) => {
      throw new Error(`Unexpected request: ${String(args[0])}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "/new",
      onSlashAction,
    });

    await handleSendChat(host);

    expect(onSlashAction).toHaveBeenCalledWith("new-session");
    expect(request).not.toHaveBeenCalled();
    expect(host.chatMessage).toBe("");
  });

  it("keeps bare /reset on the command pipeline", async () => {
    const onSlashAction = vi.fn();
    const request = vi.fn(async (...args: unknown[]) => {
      const method = String(args[0]);
      if (method === "chat.send") {
        return { status: "started", runId: "run-reset" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "/reset",
      onSlashAction,
    });

    await handleSendChat(host);

    expect(onSlashAction).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        sessionKey: "agent:main",
        message: "/reset",
        deliver: false,
        idempotencyKey: expect.any(String),
      }),
    );
    const sentParams = request.mock.calls[0]?.[1] as { idempotencyKey?: string } | undefined;
    expect(host.refreshSessionsAfterChat).toContain(sentParams?.idempotencyKey);
    expect(host.chatMessage).toBe("");
  });

  it("queues /new command args while the active run is busy", async () => {
    const host = makeHost({
      chatRunId: "run-1",
      chatStream: "Working...",
      chatMessage: "/new --persona finance",
    });

    await handleSendChat(host);

    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        text: "/new --persona finance",
        refreshSessions: true,
        localCommandName: "new",
        localCommandArgs: "--persona finance",
      }),
    ]);
    expect(host.chatMessage).toBe("");
  });
});
