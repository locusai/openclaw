import type {
  ControlUiExtensionDescriptor,
  ControlUiExtensionsListResponse,
} from "../extensions/types.ts";
import type { GatewayBrowserClient } from "../gateway.ts";

export type ControlUiExtensionsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  controlUiExtensionsLoading: boolean;
  controlUiExtensionsError: string | null;
  controlUiExtensions: ControlUiExtensionDescriptor[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeExtension(entry: unknown): ControlUiExtensionDescriptor | null {
  if (!isRecord(entry)) {
    return null;
  }
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const pluginId = typeof entry.pluginId === "string" ? entry.pluginId.trim() : "";
  const extensionId = typeof entry.extensionId === "string" ? entry.extensionId.trim() : "";
  const label = typeof entry.label === "string" ? entry.label.trim() : "";
  const mount = isRecord(entry.mount) ? entry.mount : null;
  if (!id || !pluginId || !extensionId || !label || !mount) {
    return null;
  }
  const kind = mount.kind === "web_component" ? "web_component" : null;
  const modulePath = typeof mount.modulePath === "string" ? mount.modulePath.trim() : "";
  const tagNameRaw = typeof mount.tagName === "string" ? mount.tagName.trim().toLowerCase() : "";
  if (!kind || !modulePath || !modulePath.startsWith("/") || !tagNameRaw) {
    return null;
  }
  if (!/^[a-z][a-z0-9._-]*-[a-z0-9._-]+$/.test(tagNameRaw)) {
    return null;
  }
  const exportName = typeof mount.exportName === "string" ? mount.exportName.trim() : "";
  const adapterId = typeof mount.adapterId === "string" ? mount.adapterId.trim() : "";
  const sessionAttribute =
    typeof mount.sessionAttribute === "string" ? mount.sessionAttribute.trim() : "";
  const description = typeof entry.description === "string" ? entry.description.trim() : "";
  const icon = typeof entry.icon === "string" ? entry.icon.trim() : "";
  const group = typeof entry.group === "string" ? entry.group.trim() : "";
  const order =
    typeof entry.order === "number" && Number.isFinite(entry.order) ? entry.order : undefined;
  return {
    id,
    pluginId,
    extensionId,
    label,
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
    ...(group ? { group } : {}),
    ...(order !== undefined ? { order } : {}),
    mount: {
      kind,
      modulePath,
      tagName: tagNameRaw,
      ...(exportName ? { exportName } : {}),
      ...(adapterId ? { adapterId } : {}),
      ...(sessionAttribute ? { sessionAttribute } : {}),
    },
  };
}

export async function loadControlUiExtensions(state: ControlUiExtensionsState): Promise<void> {
  if (!state.client || !state.connected) {
    state.controlUiExtensions = [];
    state.controlUiExtensionsError = null;
    state.controlUiExtensionsLoading = false;
    return;
  }
  if (state.controlUiExtensionsLoading) {
    return;
  }
  state.controlUiExtensionsLoading = true;
  state.controlUiExtensionsError = null;
  try {
    const response = await state.client.request<ControlUiExtensionsListResponse>(
      "controlui.extensions.list",
      {},
    );
    const raw = Array.isArray(response?.extensions) ? response.extensions : [];
    state.controlUiExtensions = raw
      .map((entry) => normalizeExtension(entry))
      .filter((entry): entry is ControlUiExtensionDescriptor => Boolean(entry));
  } catch (err) {
    state.controlUiExtensionsError = err instanceof Error ? err.message : String(err);
    state.controlUiExtensions = [];
  } finally {
    state.controlUiExtensionsLoading = false;
  }
}
