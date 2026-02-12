import type { PluginUiDescriptor } from "./types.ts";

export type PluginUiAdapterContext = {
  extension: PluginUiDescriptor;
  sessionKey: string;
};

export type PluginUiAdapterFactory = (context: PluginUiAdapterContext) => unknown;

export type PluginUiRuntimeApi = {
  registerAdapter: (adapterId: string, factory: PluginUiAdapterFactory) => void;
};

const ADAPTER_REGISTRY_SYMBOL = Symbol.for("openclaw.pluginUi.adapterRegistry");
const RUNTIME_API_SYMBOL = Symbol.for("openclaw.pluginUi.runtimeApi");
const RUNTIME_API_GLOBAL_KEY = "__OPENCLAW_PLUGIN_UI_RUNTIME__";

type AdapterRegistry = Map<string, PluginUiAdapterFactory>;

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

export function registerPluginUiAdapter(adapterId: string, factory: PluginUiAdapterFactory): void {
  const id = normalizeAdapterId(adapterId);
  if (!id) {
    return;
  }
  resolveAdapterRegistry().set(id, factory);
}

export function resolvePluginUiAdapter(
  adapterId: string,
  context: PluginUiAdapterContext,
): unknown {
  const id = normalizeAdapterId(adapterId);
  if (!id) {
    return undefined;
  }
  return resolveAdapterRegistry().get(id)?.(context);
}

export function getPluginUiRuntimeApi(): PluginUiRuntimeApi {
  const globalStore = globalThis as typeof globalThis & {
    [RUNTIME_API_SYMBOL]?: PluginUiRuntimeApi;
  };
  if (!globalStore[RUNTIME_API_SYMBOL]) {
    globalStore[RUNTIME_API_SYMBOL] = {
      registerAdapter: (adapterId, factory) => registerPluginUiAdapter(adapterId, factory),
    };
  }
  return globalStore[RUNTIME_API_SYMBOL];
}

export function installPluginUiRuntimeApi(): void {
  const api = getPluginUiRuntimeApi();
  const root = globalThis as typeof globalThis & {
    [RUNTIME_API_GLOBAL_KEY]?: PluginUiRuntimeApi;
  };
  root[RUNTIME_API_GLOBAL_KEY] = api;
}

declare global {
  var __OPENCLAW_PLUGIN_UI_RUNTIME__: PluginUiRuntimeApi | undefined;
}
