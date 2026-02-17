import type { PluginUiDescriptor } from "./types.ts";
import { getPluginUiRuntimeApi } from "./runtime.ts";

type DefinePluginUi = (api: ReturnType<typeof getPluginUiRuntimeApi>) => void | Promise<void>;

type ExtensionModule = Record<string, unknown> & {
  definePluginUi?: DefinePluginUi;
};

const extensionLoadPromises = new Map<string, Promise<void>>();

function resolveLoadKey(extension: PluginUiDescriptor): string {
  return `${extension.id}:${extension.mount.modulePath}`;
}

export async function ensurePluginUiLoaded(extension: PluginUiDescriptor): Promise<void> {
  const key = resolveLoadKey(extension);
  const existing = extensionLoadPromises.get(key);
  if (existing) {
    return existing;
  }
  const loadPromise = (async () => {
    try {
      const loaded = (await import(extension.mount.modulePath)) as ExtensionModule;
      const runtimeApi = getPluginUiRuntimeApi();
      const exportName = extension.mount.exportName?.trim();
      if (exportName) {
        const handler = loaded[exportName];
        if (typeof handler === "function") {
          await (handler as DefinePluginUi)(runtimeApi);
        } else {
          throw new Error(
            `Extension module ${extension.mount.modulePath} is missing function export "${exportName}".`,
          );
        }
      } else if (typeof loaded.definePluginUi === "function") {
        await loaded.definePluginUi(runtimeApi);
      }
    } catch (err) {
      extensionLoadPromises.delete(key);
      throw err;
    }
  })();
  extensionLoadPromises.set(key, loadPromise);
  return loadPromise;
}
