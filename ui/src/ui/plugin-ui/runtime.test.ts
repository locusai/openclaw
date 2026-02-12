import { describe, expect, it } from "vitest";
import type { PluginUiDescriptor } from "./types.ts";
import {
  getPluginUiRuntimeApi,
  installPluginUiRuntimeApi,
  registerPluginUiAdapter,
  resolvePluginUiAdapter,
} from "./runtime.ts";

const EXTENSION: PluginUiDescriptor = {
  id: "plugin:demo",
  pluginId: "plugin",
  extensionId: "demo",
  label: "Demo",
  mount: {
    kind: "web_component",
    modulePath: "/control-ui/plugin-demo.js",
    tagName: "plugin-demo",
  },
};

describe("plugin UI runtime adapter registry", () => {
  it("registers and resolves adapters", () => {
    const adapterId = `adapter-${Math.random().toString(16).slice(2)}`;
    registerPluginUiAdapter(adapterId, ({ sessionKey }) => ({ sessionKey, ok: true }));

    const adapter = resolvePluginUiAdapter(adapterId, {
      extension: EXTENSION,
      sessionKey: "main",
    });

    expect(adapter).toEqual({ sessionKey: "main", ok: true });
  });

  it("normalizes adapter ids for lookup", () => {
    const adapterId = `adapter-${Math.random().toString(16).slice(2)}`;
    registerPluginUiAdapter(` ${adapterId.toUpperCase()} `, () => "value");
    expect(
      resolvePluginUiAdapter(adapterId, {
        extension: EXTENSION,
        sessionKey: "main",
      }),
    ).toBe("value");
  });

  it("installs runtime api on globalThis", () => {
    installPluginUiRuntimeApi();
    expect(globalThis.__OPENCLAW_PLUGIN_UI_RUNTIME__).toBeDefined();
    expect(globalThis.__OPENCLAW_PLUGIN_UI_RUNTIME__).toBe(getPluginUiRuntimeApi());
    const adapterId = `adapter-${Math.random().toString(16).slice(2)}`;
    globalThis.__OPENCLAW_PLUGIN_UI_RUNTIME__?.registerAdapter(adapterId, () => "from-global");
    expect(
      resolvePluginUiAdapter(adapterId, {
        extension: EXTENSION,
        sessionKey: "main",
      }),
    ).toBe("from-global");
  });
});
