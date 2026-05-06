import { beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  clearPluginCommandOptions,
  executePluginCommandOptions,
  registerPluginCommandOption,
  stripPluginCommandOptionsFromBody,
} from "./command-options.js";

const cfg = {} as OpenClawConfig;

describe("plugin command options", () => {
  beforeEach(() => {
    clearPluginCommandOptions();
  });

  it("registers and executes a generic command option", async () => {
    const registered = registerPluginCommandOption("test-plugin", {
      command: "new",
      option: "print",
      takesValue: true,
      handler: async (ctx) => ({ action: "reply", reply: { text: `print:${ctx.option.value}` } }),
    });
    expect(registered.ok).toBe(true);

    const result = await executePluginCommandOptions({
      commandBody: "/new --print hello",
      channel: "whatsapp",
      isAuthorizedSender: true,
      config: cfg,
    });
    expect(result.matched).toBe(true);
    expect(result.shouldStop).toBe(true);
    expect(result.reply?.text).toBe("print:hello");
  });

  it("continues core processing when handler does not return a stop action", async () => {
    const registered = registerPluginCommandOption("test-plugin", {
      command: "new",
      option: "flag",
      handler: async () => ({ action: "continue" }),
    });
    expect(registered.ok).toBe(true);

    const result = await executePluginCommandOptions({
      commandBody: "/new --flag keep-going",
      channel: "whatsapp",
      isAuthorizedSender: true,
      config: cfg,
    });
    expect(result.matched).toBe(true);
    expect(result.shouldStop).toBe(false);
    expect(result.commandBody).toBe("/new keep-going");
  });

  it("runs command options only in their registered phase", async () => {
    const calls: string[] = [];
    expect(
      registerPluginCommandOption("test-plugin", {
        command: "new",
        option: "persona",
        phase: "after-core",
        takesValue: true,
        handler: async (ctx) => {
          calls.push(`${ctx.invocation.phase}:${ctx.option.value}`);
          return { action: "continue" };
        },
      }).ok,
    ).toBe(true);

    const before = await executePluginCommandOptions({
      commandBody: "/new --persona finance",
      phase: "before-core",
      channel: "whatsapp",
      isAuthorizedSender: true,
      config: cfg,
    });
    expect(before.matched).toBe(false);
    expect(before.commandBody).toBe("/new --persona finance");
    expect(calls).toEqual([]);

    const after = await executePluginCommandOptions({
      commandBody: "/new --persona finance",
      phase: "after-core",
      channel: "whatsapp",
      isAuthorizedSender: true,
      config: cfg,
    });
    expect(after.matched).toBe(true);
    expect(after.commandBody).toBe("/new");
    expect(calls).toEqual(["after-core:finance"]);
  });

  it("strips consumed options before core handling even when handler phase is after-core", () => {
    expect(
      registerPluginCommandOption("test-plugin", {
        command: "new",
        option: "persona",
        phase: "after-core",
        takesValue: true,
        handler: async () => ({ action: "continue" }),
      }).ok,
    ).toBe(true);

    const result = stripPluginCommandOptionsFromBody({
      commandBody: "/new --persona finance continue this",
    });
    expect(result.matched).toBe(true);
    expect(result.commandBody).toBe("/new continue this");
  });

  it("supports namespace selection with positional prefix", async () => {
    const registered = registerPluginCommandOption("test-plugin", {
      command: "new",
      option: "print",
      namespace: "demo",
      takesValue: true,
      handler: async (ctx) => ({
        action: "reply",
        reply: { text: `ns:${ctx.invocation.namespace}` },
      }),
    });
    expect(registered.ok).toBe(true);

    const result = await executePluginCommandOptions({
      commandBody: "/new demo --print hi",
      channel: "whatsapp",
      isAuthorizedSender: true,
      config: cfg,
    });
    expect(result.shouldStop).toBe(true);
    expect(result.reply?.text).toBe("ns:demo");
  });

  it("supports namespace selection with --plugin", async () => {
    const registered = registerPluginCommandOption("test-plugin", {
      command: "new",
      option: "print",
      namespace: "demo",
      takesValue: true,
      handler: async () => ({ action: "reply", reply: { text: "ok" } }),
    });
    expect(registered.ok).toBe(true);

    const result = await executePluginCommandOptions({
      commandBody: "/new --plugin demo --print hi",
      channel: "whatsapp",
      isAuthorizedSender: true,
      config: cfg,
    });
    expect(result.shouldStop).toBe(true);
    expect(result.reply?.text).toBe("ok");
  });

  it("does not dispatch ambiguous namespaced options without a namespace selector", async () => {
    expect(
      registerPluginCommandOption("plugin-a", {
        command: "new",
        option: "mode",
        namespace: "a",
        handler: async () => ({ action: "reply", reply: { text: "a" } }),
      }).ok,
    ).toBe(true);
    expect(
      registerPluginCommandOption("plugin-b", {
        command: "new",
        option: "mode",
        namespace: "b",
        handler: async () => ({ action: "reply", reply: { text: "b" } }),
      }).ok,
    ).toBe(true);

    const result = await executePluginCommandOptions({
      commandBody: "/new --mode test",
      channel: "whatsapp",
      isAuthorizedSender: true,
      config: cfg,
    });
    expect(result.matched).toBe(false);
    expect(result.shouldStop).toBe(false);
    expect(result.commandBody).toBe("/new --mode test");
  });

  it("blocks unauthorized senders when requireAuth is true", async () => {
    const registered = registerPluginCommandOption("test-plugin", {
      command: "new",
      option: "print",
      handler: async () => ({ action: "reply", reply: { text: "ok" } }),
    });
    expect(registered.ok).toBe(true);

    const result = await executePluginCommandOptions({
      commandBody: "/new --print hello",
      channel: "whatsapp",
      isAuthorizedSender: false,
      config: cfg,
    });
    expect(result.shouldStop).toBe(true);
    expect(result.reply?.text).toContain("requires authorization");
  });

  it("enforces the generic registration shape at runtime", () => {
    expect(
      registerPluginCommandOption("test-plugin", {
        command: "launch",
        option: "mode",
        phase: "during-core",
        handler: async () => ({ action: "continue" }),
      } as Parameters<typeof registerPluginCommandOption>[1]).ok,
    ).toBe(false);

    expect(
      registerPluginCommandOption("test-plugin", {
        command: "launch",
        option: "bad option",
        handler: async () => ({ action: "continue" }),
      }).ok,
    ).toBe(false);
  });

  it("passes generic option invocation context without consuming the option when requested", async () => {
    const seen: unknown[] = [];
    const registered = registerPluginCommandOption("test-plugin", {
      command: "launch",
      option: "mode",
      aliases: ["m"],
      namespace: "demo",
      namespaceAliases: ["d"],
      phase: "after-core",
      takesValue: true,
      consume: false,
      requireAuth: false,
      handler: async (ctx) => {
        seen.push({
          commandName: ctx.invocation.commandName,
          phase: ctx.invocation.phase,
          namespace: ctx.invocation.namespace,
          option: ctx.option,
          options: ctx.invocation.options,
          positionals: ctx.invocation.positionals,
          sessionKey: ctx.sessionKey,
          sessionId: ctx.sessionId,
          channel: ctx.channel,
          accountId: ctx.accountId,
          messageThreadId: ctx.messageThreadId,
        });
        return { action: "continue" };
      },
    });
    expect(registered.ok).toBe(true);

    const commandBody = "/launch d --m=blue target";
    const commandBodyForCore = "/launch --m=blue target";
    const result = await executePluginCommandOptions({
      commandBody,
      phase: "after-core",
      sessionKey: "agent:demo:main",
      sessionId: "session-1",
      channel: "webchat",
      isAuthorizedSender: false,
      config: cfg,
      accountId: "acct-1",
      messageThreadId: 42,
    });

    expect(result.matched).toBe(true);
    expect(result.shouldStop).toBe(false);
    expect(result.commandBody).toBe(commandBodyForCore);
    expect(seen).toEqual([
      {
        commandName: "launch",
        phase: "after-core",
        namespace: "d",
        option: { name: "m", presentAs: "m", value: "blue" },
        options: [{ name: "m", presentAs: "m", value: "blue" }],
        positionals: ["target"],
        sessionKey: "agent:demo:main",
        sessionId: "session-1",
        channel: "webchat",
        accountId: "acct-1",
        messageThreadId: 42,
      },
    ]);

    expect(stripPluginCommandOptionsFromBody({ commandBody }).commandBody).toBe(commandBodyForCore);
  });
});
