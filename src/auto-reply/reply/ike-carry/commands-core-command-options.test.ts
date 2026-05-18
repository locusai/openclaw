import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../../config/config.js";
import {
  clearPluginCommandOptions,
  registerPluginCommandOption,
} from "../../../plugins/command-options.js";
import type { MsgContext } from "../../templating.js";
import type { HandleCommandsParams } from "../commands-types.js";
import { parseInlineDirectives } from "../directive-handling.parse.js";

const maybeHandleResetCommandMock = vi.hoisted(() => vi.fn());

vi.mock("../commands-reset.js", () => ({
  maybeHandleResetCommand: maybeHandleResetCommandMock,
}));

vi.mock("../../commands-registry.js", () => ({
  shouldHandleTextCommands: () => true,
}));

vi.mock("../commands-handlers.runtime.js", () => ({
  loadCommandHandlers: () => [],
}));

function buildParams(commandBody: string): HandleCommandsParams {
  const ctx = {
    Body: commandBody,
    CommandBody: commandBody,
    CommandSource: "text",
    CommandAuthorized: true,
    Provider: "webchat",
    Surface: "webchat",
    SessionKey: "agent:main:main",
  } as MsgContext;

  return {
    ctx,
    cfg: {
      commands: { text: true },
      channels: { webchat: { allowFrom: ["*"] } },
    } as OpenClawConfig,
    command: {
      rawBodyNormalized: commandBody.trim(),
      commandBodyNormalized: commandBody.trim(),
      isAuthorizedSender: true,
      senderIsOwner: true,
      senderId: "owner",
      channel: "webchat",
      channelId: "webchat",
      surface: "webchat",
      ownerList: [],
      from: "owner",
      to: "bot",
      resetHookTriggered: false,
    },
    directives: parseInlineDirectives(""),
    elevated: { enabled: true, allowed: true, failures: [] },
    sessionKey: "agent:main:main",
    workspaceDir: "/tmp/openclaw-ike-command-options",
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "webchat",
    model: "test-model",
    contextTokens: 0,
    isGroup: false,
  };
}

function installMockResetCommand(order?: string[]) {
  maybeHandleResetCommandMock.mockImplementation(async (params: HandleCommandsParams) => {
    const match = params.command.commandBodyNormalized.match(/^\/(new|reset)(?:\s|$)/);
    if (!match) {
      return null;
    }
    const action = match[1] === "reset" ? "reset" : "new";
    order?.push(`hook:${action}`);
    const tail = params.command.commandBodyNormalized.slice(match[0].length).trimStart();
    params.command.resetHookTriggered = true;
    if (tail) {
      return null;
    }
    return {
      shouldContinue: false,
      reply: {
        text: action === "reset" ? "✅ Session reset." : "✅ New session started.",
      },
    };
  });
}

describe("IKE carry command option super contract", () => {
  beforeEach(() => {
    maybeHandleResetCommandMock.mockClear();
    installMockResetCommand();
    clearPluginCommandOptions();
  });

  it.each([
    { command: "/new --persona finance take notes", stripped: "/new take notes", action: "new" },
    {
      command: "/reset --persona finance take notes",
      stripped: "/reset take notes",
      action: "reset",
    },
  ])(
    "runs plugin options before core $action handling and continues with stripped command body",
    async ({ command, stripped, action }) => {
      const order: string[] = [];
      installMockResetCommand(order);
      expect(
        registerPluginCommandOption("ike-test", {
          command: action,
          option: "persona",
          takesValue: true,
          handler: async (ctx) => {
            order.push(`option:${ctx.option.value}`);
            return { action: "continue" };
          },
        }).ok,
      ).toBe(true);

      const params = buildParams(command);
      const { handleCommands } = await import("../commands-core.js");

      const result = await handleCommands(params);

      expect(order).toEqual(["option:finance", `hook:${action}`]);
      expect(params.command.commandBodyNormalized).toBe(stripped);
      expect(params.command.resetHookTriggered).toBe(true);
      expect(result).toEqual({ shouldContinue: true });
    },
  );

  it.each([
    {
      command: "/new --persona finance",
      stripped: "/new",
      action: "new",
      replyText: "New session started.",
    },
    {
      command: "/reset --persona finance",
      stripped: "/reset",
      action: "reset",
      replyText: "Session reset.",
    },
  ])(
    "preserves bare core $action acknowledgement after option handling",
    async ({ command, stripped, action, replyText }) => {
      const order: string[] = [];
      installMockResetCommand(order);
      expect(
        registerPluginCommandOption("ike-test", {
          command: action,
          option: "persona",
          takesValue: true,
          handler: async (ctx) => {
            order.push(`option:${ctx.option.value}`);
            return { action: "continue" };
          },
        }).ok,
      ).toBe(true);

      const params = buildParams(command);
      const { handleCommands } = await import("../commands-core.js");

      const result = await handleCommands(params);

      expect(order).toEqual(["option:finance", `hook:${action}`]);
      expect(params.command.commandBodyNormalized).toBe(stripped);
      expect(result.shouldContinue).toBe(false);
      expect(result.reply?.text).toContain(replyText);
    },
  );

  it("lets a command option stop core reset handling with a reply", async () => {
    expect(
      registerPluginCommandOption("ike-test", {
        command: "new",
        option: "persona",
        takesValue: true,
        handler: async (ctx) => ({
          action: "reply",
          reply: { text: `selected:${ctx.option.value}` },
        }),
      }).ok,
    ).toBe(true);

    const params = buildParams("/new --persona finance");
    const { handleCommands } = await import("../commands-core.js");

    const result = await handleCommands(params);

    expect(maybeHandleResetCommandMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      shouldContinue: false,
      reply: {
        text: "selected:finance",
        replyToId: undefined,
        replyToCurrent: false,
      },
    });
  });

  it("supports post-core command option handlers without leaking consumed options into core", async () => {
    const order: string[] = [];
    installMockResetCommand(order);
    expect(
      registerPluginCommandOption("ike-test", {
        command: "new",
        option: "persona",
        phase: "after-core",
        takesValue: true,
        handler: async (ctx) => {
          order.push(`${ctx.invocation.phase}:${ctx.option.value}`);
          return { action: "continue" };
        },
      }).ok,
    ).toBe(true);

    const params = buildParams("/new --persona finance");
    const { handleCommands } = await import("../commands-core.js");

    const result = await handleCommands(params);

    expect(order).toEqual(["hook:new", "after-core:finance"]);
    expect(params.command.commandBodyNormalized).toBe("/new");
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("New session started.");
  });
});
