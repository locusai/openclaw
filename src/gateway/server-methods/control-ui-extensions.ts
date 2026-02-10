import type { OpenClawPluginControlUiExtension } from "../../plugins/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { getActivePluginRegistry } from "../../plugins/runtime.js";

export type ControlUiExtensionDescriptor = {
  id: string;
  pluginId: string;
  extensionId: string;
  label: string;
  description?: string;
  icon?: string;
  group?: string;
  order?: number;
  mount: OpenClawPluginControlUiExtension["mount"];
};

function resolveDescriptorId(pluginId: string, extensionId: string): string {
  return `${pluginId}:${extensionId}`;
}

function normalizeControlUiExtension(params: {
  pluginId: string;
  extension: OpenClawPluginControlUiExtension;
}): ControlUiExtensionDescriptor | null {
  const pluginId = params.pluginId.trim();
  const extensionId = params.extension.id.trim();
  const label = params.extension.label.trim();
  const modulePath = params.extension.mount.modulePath.trim();
  const tagName = params.extension.mount.tagName.trim().toLowerCase();
  if (!pluginId || !extensionId || !label || !modulePath || !tagName) {
    return null;
  }
  if (params.extension.mount.kind !== "web_component") {
    return null;
  }
  if (!modulePath.startsWith("/")) {
    return null;
  }
  if (!/^[a-z][a-z0-9._-]*-[a-z0-9._-]+$/.test(tagName)) {
    return null;
  }
  const icon = params.extension.icon?.trim() || undefined;
  const group = params.extension.group?.trim() || undefined;
  const description = params.extension.description?.trim() || undefined;
  const order =
    typeof params.extension.order === "number" && Number.isFinite(params.extension.order)
      ? params.extension.order
      : undefined;
  return {
    id: resolveDescriptorId(pluginId, extensionId),
    pluginId,
    extensionId,
    label,
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
    ...(group ? { group } : {}),
    ...(order !== undefined ? { order } : {}),
    mount: {
      ...params.extension.mount,
      modulePath,
      tagName,
    },
  };
}

export const controlUiExtensionsHandlers: GatewayRequestHandlers = {
  "controlui.extensions.list": ({ respond }) => {
    const registry = getActivePluginRegistry();
    const raw = registry?.controlUiExtensions ?? [];
    const extensions = raw
      .map((entry) =>
        normalizeControlUiExtension({
          pluginId: entry.pluginId,
          extension: entry.extension,
        }),
      )
      .filter((entry): entry is ControlUiExtensionDescriptor => Boolean(entry))
      .toSorted((a, b) => {
        const aOrder = a.order ?? 100;
        const bOrder = b.order ?? 100;
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }
        return a.label.localeCompare(b.label);
      });
    respond(true, { extensions });
  },
};
