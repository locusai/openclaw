import type { ControlUiExtensionDescriptor } from "./types.ts";
import { getControlUiRuntimeApi } from "./runtime.ts";

type DefineControlUiExtension = (
  api: ReturnType<typeof getControlUiRuntimeApi>,
) => void | Promise<void>;

type ExtensionModule = Record<string, unknown> & {
  defineControlUiExtension?: DefineControlUiExtension;
};

const extensionLoadPromises = new Map<string, Promise<void>>();

function resolveLoadKey(extension: ControlUiExtensionDescriptor): string {
  return `${extension.id}:${extension.mount.modulePath}`;
}

export async function ensureControlUiExtensionLoaded(
  extension: ControlUiExtensionDescriptor,
): Promise<void> {
  const key = resolveLoadKey(extension);
  const existing = extensionLoadPromises.get(key);
  if (existing) {
    return existing;
  }
  const loadPromise = (async () => {
    try {
      const loaded = (await import(extension.mount.modulePath)) as ExtensionModule;
      const runtimeApi = getControlUiRuntimeApi();
      const exportName = extension.mount.exportName?.trim();
      if (exportName) {
        const handler = loaded[exportName];
        if (typeof handler === "function") {
          await (handler as DefineControlUiExtension)(runtimeApi);
        } else {
          throw new Error(
            `Extension module ${extension.mount.modulePath} is missing function export "${exportName}".`,
          );
        }
      } else if (typeof loaded.defineControlUiExtension === "function") {
        await loaded.defineControlUiExtension(runtimeApi);
      }
    } catch (err) {
      extensionLoadPromises.delete(key);
      throw err;
    }
  })();
  extensionLoadPromises.set(key, loadPromise);
  return loadPromise;
}
