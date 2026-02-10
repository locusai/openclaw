import type { ControlUiExtensionDescriptor } from "./types.ts";

export type ControlUiExtensionAdapterContext = {
  extension: ControlUiExtensionDescriptor;
  sessionKey: string;
};

export type ControlUiExtensionAdapterFactory = (
  context: ControlUiExtensionAdapterContext,
) => unknown;

export type ControlUiExtensionRuntimeApi = {
  registerAdapter: (adapterId: string, factory: ControlUiExtensionAdapterFactory) => void;
};

const ADAPTER_REGISTRY_SYMBOL = Symbol.for("openclaw.controlUi.adapterRegistry");
const RUNTIME_API_SYMBOL = Symbol.for("openclaw.controlUi.runtimeApi");
const RUNTIME_API_GLOBAL_KEY = "__OPENCLAW_CONTROL_UI_RUNTIME__";

type AdapterRegistry = Map<string, ControlUiExtensionAdapterFactory>;

function resolveAdapterRegistry(): AdapterRegistry {
  const globalStore = globalThis as typeof globalThis & {
    [ADAPTER_REGISTRY_SYMBOL]?: AdapterRegistry;
  };
  if (!globalStore[ADAPTER_REGISTRY_SYMBOL]) {
    globalStore[ADAPTER_REGISTRY_SYMBOL] = new Map();
  }
  return globalStore[ADAPTER_REGISTRY_SYMBOL];
}

function normalizeAdapterId(value: string): string {
  return value.trim().toLowerCase();
}

export function registerControlUiAdapter(
  adapterId: string,
  factory: ControlUiExtensionAdapterFactory,
): void {
  const id = normalizeAdapterId(adapterId);
  if (!id) {
    return;
  }
  resolveAdapterRegistry().set(id, factory);
}

export function resolveControlUiAdapter(
  adapterId: string,
  context: ControlUiExtensionAdapterContext,
): unknown {
  const id = normalizeAdapterId(adapterId);
  if (!id) {
    return undefined;
  }
  return resolveAdapterRegistry().get(id)?.(context);
}

export function getControlUiRuntimeApi(): ControlUiExtensionRuntimeApi {
  const globalStore = globalThis as typeof globalThis & {
    [RUNTIME_API_SYMBOL]?: ControlUiExtensionRuntimeApi;
  };
  if (!globalStore[RUNTIME_API_SYMBOL]) {
    globalStore[RUNTIME_API_SYMBOL] = {
      registerAdapter: (adapterId, factory) => registerControlUiAdapter(adapterId, factory),
    };
  }
  return globalStore[RUNTIME_API_SYMBOL];
}

export function installControlUiRuntimeApi(): void {
  const api = getControlUiRuntimeApi();
  const root = globalThis as typeof globalThis & {
    [RUNTIME_API_GLOBAL_KEY]?: ControlUiExtensionRuntimeApi;
  };
  root[RUNTIME_API_GLOBAL_KEY] = api;
}

declare global {
  var __OPENCLAW_CONTROL_UI_RUNTIME__: ControlUiExtensionRuntimeApi | undefined;
}
