import { describe, expect, it } from "vitest";
import type { ControlUiExtensionDescriptor } from "./types.ts";
import {
  getControlUiRuntimeApi,
  installControlUiRuntimeApi,
  registerControlUiAdapter,
  resolveControlUiAdapter,
} from "./runtime.ts";

const EXTENSION: ControlUiExtensionDescriptor = {
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

describe("control UI runtime adapter registry", () => {
  it("registers and resolves adapters", () => {
    const adapterId = `adapter-${Math.random().toString(16).slice(2)}`;
    registerControlUiAdapter(adapterId, ({ sessionKey }) => ({ sessionKey, ok: true }));

    const adapter = resolveControlUiAdapter(adapterId, {
      extension: EXTENSION,
      sessionKey: "main",
    });

    expect(adapter).toEqual({ sessionKey: "main", ok: true });
  });

  it("normalizes adapter ids for lookup", () => {
    const adapterId = `adapter-${Math.random().toString(16).slice(2)}`;
    registerControlUiAdapter(` ${adapterId.toUpperCase()} `, () => "value");
    expect(
      resolveControlUiAdapter(adapterId, {
        extension: EXTENSION,
        sessionKey: "main",
      }),
    ).toBe("value");
  });

  it("installs runtime api on globalThis", () => {
    installControlUiRuntimeApi();
    expect(globalThis.__OPENCLAW_CONTROL_UI_RUNTIME__).toBeDefined();
    expect(globalThis.__OPENCLAW_CONTROL_UI_RUNTIME__).toBe(getControlUiRuntimeApi());
    const adapterId = `adapter-${Math.random().toString(16).slice(2)}`;
    globalThis.__OPENCLAW_CONTROL_UI_RUNTIME__?.registerAdapter(adapterId, () => "from-global");
    expect(
      resolveControlUiAdapter(adapterId, {
        extension: EXTENSION,
        sessionKey: "main",
      }),
    ).toBe("from-global");
  });
});
