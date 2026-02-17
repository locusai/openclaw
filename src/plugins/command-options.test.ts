import { beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  clearPluginCommandOptions,
  executePluginCommandOptions,
  registerPluginCommandOption,
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
});
