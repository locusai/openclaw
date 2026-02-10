import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";
import { controlUiExtensionsHandlers } from "./control-ui-extensions.js";

const mocks = vi.hoisted(() => ({
  getActivePluginRegistry: vi.fn(),
}));

vi.mock("../../plugins/runtime.js", () => ({
  getActivePluginRegistry: mocks.getActivePluginRegistry,
}));

const invokeList = (respond: GatewayRequestHandlerOptions["respond"]) => {
  void controlUiExtensionsHandlers["controlui.extensions.list"]({
    req: { type: "req", id: "1", method: "controlui.extensions.list" },
    params: {},
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {} as GatewayRequestHandlerOptions["context"],
  });
};

describe("controlui.extensions.list", () => {
  beforeEach(() => {
    mocks.getActivePluginRegistry.mockReset();
  });

  it("returns sanitized extensions sorted by order then label", () => {
    mocks.getActivePluginRegistry.mockReturnValue({
      controlUiExtensions: [
        {
          pluginId: "plugin-z",
          extension: {
            id: "zeta",
            label: "Zeta",
            order: 20,
            mount: {
              kind: "web_component",
              modulePath: "/plugins/zeta.js",
              tagName: "zeta-panel",
            },
          },
        },
        {
          pluginId: "plugin-a",
          extension: {
            id: "alpha",
            label: "Alpha",
            order: 10,
            mount: {
              kind: "web_component",
              modulePath: "/plugins/alpha.js",
              tagName: "alpha-panel",
            },
          },
        },
        {
          pluginId: "plugin-b",
          extension: {
            id: "beta",
            label: "Beta",
            mount: {
              kind: "web_component",
              modulePath: "/plugins/beta.js",
              tagName: "beta-panel",
            },
          },
        },
        {
          pluginId: "plugin-c",
          extension: {
            id: "invalid",
            label: "Invalid",
            mount: {
              kind: "web_component",
              modulePath: "plugins/invalid.js",
              tagName: "invalid-panel",
            },
          },
        },
      ],
    });

    const respond = vi.fn();
    invokeList(respond);

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(true, {
      extensions: [
        expect.objectContaining({
          id: "plugin-a:alpha",
          pluginId: "plugin-a",
          extensionId: "alpha",
          label: "Alpha",
        }),
        expect.objectContaining({
          id: "plugin-z:zeta",
          pluginId: "plugin-z",
          extensionId: "zeta",
          label: "Zeta",
        }),
        expect.objectContaining({
          id: "plugin-b:beta",
          pluginId: "plugin-b",
          extensionId: "beta",
          label: "Beta",
        }),
      ],
    });
  });

  it("normalizes tagName and optional mount fields", () => {
    mocks.getActivePluginRegistry.mockReturnValue({
      controlUiExtensions: [
        {
          pluginId: "plugin-x",
          extension: {
            id: "widget",
            label: "Widget",
            mount: {
              kind: "web_component",
              modulePath: "/plugins/widget.js",
              tagName: "WIDGET-PANEL",
              exportName: "defineWidget",
              adapterId: "chat-adapter",
              sessionAttribute: "session-id",
            },
          },
        },
      ],
    });

    const respond = vi.fn();
    invokeList(respond);

    expect(respond).toHaveBeenCalledWith(true, {
      extensions: [
        {
          id: "plugin-x:widget",
          pluginId: "plugin-x",
          extensionId: "widget",
          label: "Widget",
          mount: {
            kind: "web_component",
            modulePath: "/plugins/widget.js",
            tagName: "widget-panel",
            exportName: "defineWidget",
            adapterId: "chat-adapter",
            sessionAttribute: "session-id",
          },
        },
      ],
    });
  });
});
