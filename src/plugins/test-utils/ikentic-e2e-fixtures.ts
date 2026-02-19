import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { OpenClawConfig } from "../../config/config.js";
import { captureEnv } from "../../test-utils/env.js";
import { clearPluginCommandOptions } from "../command-options.js";
import { clearPluginCommands, matchPluginCommand } from "../commands.js";
import {
  getGlobalHookRunner,
  initializeGlobalHookRunner,
  resetGlobalHookRunner,
} from "../hook-runner-global.js";
import { loadOpenClawPluginsAsync } from "../loader.js";

const OPENCLAW_BUNDLED_PLUGINS_DIR_FALLBACK = "/nonexistent/bundled/plugins";
const REDIRECT_URI = "http://127.0.0.1:18789/oauth/callback";
const MODULE_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"] as const;
const IKENTIC_PLUGIN_ROOT_CANDIDATES = [
  "extensions/openclaw-ikentic-plugin",
  "../codex-ikentic-plugin-test-scaffolding/extensions/openclaw-ikentic-plugin",
  "../integration-ikentic/extensions/openclaw-ikentic-plugin",
] as const;

type PersonaSelectionStoreApi = {
  upsert: (value: {
    sessionKey: string;
    sessionId: string;
    requestedPersonaId: string;
    resolvedPersonaId: string;
    personaShortName: string;
    personaDisplayName: string;
    version: string;
    bundleHash: string;
    fallback: boolean;
    allowedTools: string[];
    approvalRequiredTools: string[];
    selectedAtMs: number;
  }) => Promise<void>;
};

type OAuthStoreApi = {
  upsertToken: (
    accountId: string,
    token: {
      accessToken: string;
      refreshToken: string;
      tokenType: string;
      scope: string;
      expiresInSeconds: number;
    },
  ) => Promise<void>;
};

type PersonaSelectionStoreCtor = new (params: { stateDir: string }) => PersonaSelectionStoreApi;
type OAuthStoreCtor = new (params: { stateDir: string }) => OAuthStoreApi;

export type IkenticE2eFixture = {
  stateDir: string;
  pluginRoot: string;
  registerIkenticPlugin: (params: { issuer: string }) => Promise<OpenClawConfig>;
  seedPersonaSelection: (params: {
    sessionKey: string;
    toolName: string;
    sessionId?: string;
    personaId?: string;
    personaDisplayName?: string;
  }) => Promise<void>;
  seedOAuthToken: (params?: {
    accountId?: string;
    accessToken?: string;
    refreshToken?: string;
    scope?: string;
    expiresInSeconds?: number;
  }) => Promise<void>;
  cleanup: () => Promise<void>;
};

function buildIkenticConfig(params: { issuer: string; pluginPath: string }): OpenClawConfig {
  return {
    plugins: {
      load: { paths: [params.pluginPath] },
      allow: ["ikentic"],
      entries: {
        ikentic: {
          enabled: true,
          config: {
            auth: {
              issuer: params.issuer,
              redirectUri: REDIRECT_URI,
              clientName: "OpenClaw IKENTIC E2E",
            },
            ike: {
              apiBaseUrl: "https://ikentic.example",
            },
          },
        },
      },
    },
  };
}

function resolveStoreCandidates(params: { pluginRoot: string; baseName: string }): string[] {
  const sourceCandidates = MODULE_EXTENSIONS.map((ext) =>
    path.join(params.pluginRoot, "src", "store", `${params.baseName}${ext}`),
  );
  return [
    path.join(params.pluginRoot, "dist", "store", `${params.baseName}.js`),
    ...sourceCandidates,
  ];
}

async function loadNamedExport<T>(params: {
  moduleCandidates: string[];
  exportName: string;
  pluginRoot: string;
}): Promise<T> {
  for (const candidate of params.moduleCandidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    let loaded: Record<string, unknown> | null = null;
    try {
      loaded = (await import(pathToFileURL(candidate).href)) as Record<string, unknown>;
    } catch {
      continue;
    }

    const value = loaded?.[params.exportName];
    if (value) {
      return value as T;
    }
  }

  throw new Error(
    `Unable to load ${params.exportName} from IKENTIC plugin root (${params.pluginRoot}).` +
      " Expected dist/store or src/store module exports.",
  );
}

function resolvePluginEntryFile(pluginRoot: string): string {
  const packagePath = path.join(pluginRoot, "package.json");
  if (fs.existsSync(packagePath)) {
    try {
      const packageRaw = fs.readFileSync(packagePath, "utf8");
      const parsed = JSON.parse(packageRaw) as {
        openclaw?: { extensions?: unknown };
      };
      const extensions = parsed.openclaw?.extensions;
      if (Array.isArray(extensions)) {
        for (const extension of extensions) {
          if (typeof extension !== "string" || !extension.trim()) {
            continue;
          }
          const candidate = path.resolve(pluginRoot, extension);
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
      }
    } catch {
      // ignore and fall through
    }
  }

  for (const extension of MODULE_EXTENSIONS) {
    const candidate = path.join(pluginRoot, "index" + extension);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const distIndex = path.join(pluginRoot, "dist", "index.js");
  if (fs.existsSync(distIndex)) {
    return distIndex;
  }

  throw new Error(`Unable to resolve IKENTIC plugin entry file from root: ${pluginRoot}`);
}

async function createIkenticLoaderFixture(
  pluginRoot: string,
): Promise<{ fixtureDir: string; pluginPath: string }> {
  const fixtureDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "openclaw-ikentic-loader-fixture-"),
  );
  const manifestPath = path.join(pluginRoot, "openclaw.plugin.json");

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`IKENTIC plugin manifest not found at: ${manifestPath}`);
  }

  await fsPromises.copyFile(manifestPath, path.join(fixtureDir, "openclaw.plugin.json"));

  const entryFileUrl = pathToFileURL(resolvePluginEntryFile(pluginRoot)).href;
  const pluginPath = path.join(fixtureDir, "ikentic-bridge.mjs");
  await fsPromises.writeFile(
    pluginPath,
    `import mod from ${JSON.stringify(entryFileUrl)};\n` +
      `const plugin = mod && typeof mod === "object" && "default" in mod ? mod.default : mod;\n` +
      `export default plugin;\n`,
    "utf8",
  );

  return { fixtureDir, pluginPath };
}

export function resolveIkenticPluginRoot(
  envValue = process.env.OPENCLAW_IKENTIC_PLUGIN_ROOT,
): string {
  const discoverDefaultRoot = () => {
    for (const candidate of IKENTIC_PLUGIN_ROOT_CANDIDATES) {
      const resolved = path.resolve(process.cwd(), candidate);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
    return "";
  };

  const rawRoot = envValue?.trim() || discoverDefaultRoot();
  if (!rawRoot) {
    throw new Error(
      "IKENTIC plugin root not found. Set OPENCLAW_IKENTIC_PLUGIN_ROOT to a plugin package root.",
    );
  }
  const resolvedRoot = path.resolve(rawRoot);

  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`IKENTIC plugin root does not exist: ${resolvedRoot}`);
  }

  const stat = fs.statSync(resolvedRoot);
  if (!stat.isDirectory()) {
    throw new Error(
      `IKENTIC plugin root must be a directory/package root (bridge files are not supported): ${resolvedRoot}`,
    );
  }

  const manifestPath = path.join(resolvedRoot, "openclaw.plugin.json");
  const packagePath = path.join(resolvedRoot, "package.json");
  if (!fs.existsSync(manifestPath) && !fs.existsSync(packagePath)) {
    throw new Error(
      `IKENTIC plugin root must contain openclaw.plugin.json or package.json: ${resolvedRoot}`,
    );
  }

  return resolvedRoot;
}

async function waitForIkenticRegistration(timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const hookReady = getGlobalHookRunner()?.hasHooks("before_tool_call") === true;
    const commandReady = Boolean(matchPluginCommand("/ikelogin"));
    if (hookReady && commandReady) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("IKENTIC plugin async registration did not complete");
}

export async function createIkenticE2eFixture(
  stateDirPrefix = "openclaw-ikentic-chat-e2e-",
): Promise<IkenticE2eFixture> {
  const pluginRoot = resolveIkenticPluginRoot();
  const loaderFixture = await createIkenticLoaderFixture(pluginRoot);
  const stateDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), stateDirPrefix));
  const envSnapshot = captureEnv([
    "OPENCLAW_STATE_DIR",
    "OPENCLAW_BUNDLED_PLUGINS_DIR",
    "OPENCLAW_IKENTIC_PLUGIN_ROOT",
  ]);

  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = OPENCLAW_BUNDLED_PLUGINS_DIR_FALLBACK;

  let isCleanedUp = false;

  const cleanup = async () => {
    if (isCleanedUp) {
      return;
    }
    isCleanedUp = true;

    resetGlobalHookRunner();
    clearPluginCommands();
    clearPluginCommandOptions();
    envSnapshot.restore();
    await fsPromises.rm(loaderFixture.fixtureDir, { recursive: true, force: true });
    await fsPromises.rm(stateDir, { recursive: true, force: true });
  };

  const seedPersonaSelection: IkenticE2eFixture["seedPersonaSelection"] = async (params) => {
    const PersonaSelectionStore = await loadNamedExport<PersonaSelectionStoreCtor>({
      moduleCandidates: resolveStoreCandidates({ pluginRoot, baseName: "persona-store" }),
      exportName: "PersonaSelectionStore",
      pluginRoot,
    });
    const store = new PersonaSelectionStore({ stateDir });
    const personaId = params.personaId ?? "finance";
    await store.upsert({
      sessionKey: params.sessionKey,
      sessionId: params.sessionId ?? "session-main",
      requestedPersonaId: personaId,
      resolvedPersonaId: personaId,
      personaShortName: personaId,
      personaDisplayName: params.personaDisplayName ?? "Finance",
      version: "v1",
      bundleHash: "bundle-hash",
      fallback: false,
      allowedTools: [params.toolName],
      approvalRequiredTools: [],
      selectedAtMs: Date.now(),
    });
  };

  const seedOAuthToken: IkenticE2eFixture["seedOAuthToken"] = async (params) => {
    const OAuthStore = await loadNamedExport<OAuthStoreCtor>({
      moduleCandidates: resolveStoreCandidates({ pluginRoot, baseName: "oauth-store" }),
      exportName: "OAuthStore",
      pluginRoot,
    });
    const store = new OAuthStore({ stateDir });
    await store.upsertToken(params?.accountId ?? "default", {
      accessToken: params?.accessToken ?? "access-token",
      refreshToken: params?.refreshToken ?? "refresh-token",
      tokenType: "Bearer",
      scope: params?.scope ?? "openid profile",
      expiresInSeconds: params?.expiresInSeconds ?? 3600,
    });
  };

  const registerIkenticPlugin: IkenticE2eFixture["registerIkenticPlugin"] = async (params) => {
    const config = buildIkenticConfig({
      issuer: params.issuer,
      pluginPath: loaderFixture.pluginPath,
    });
    const registry = await loadOpenClawPluginsAsync({
      cache: false,
      workspaceDir: process.cwd(),
      config,
    });
    const ikentic = registry.plugins.find((entry) => entry.id === "ikentic");
    if (ikentic?.status !== "loaded") {
      throw new Error(
        `Failed to load IKENTIC plugin from ${pluginRoot}: ${JSON.stringify(registry.diagnostics)}`,
      );
    }

    initializeGlobalHookRunner(registry);
    await waitForIkenticRegistration();
    return config;
  };

  return {
    stateDir,
    pluginRoot,
    registerIkenticPlugin,
    seedPersonaSelection,
    seedOAuthToken,
    cleanup,
  };
}

export async function withIkenticE2eFixture<T>(
  fn: (fixture: IkenticE2eFixture) => Promise<T>,
): Promise<T> {
  const fixture = await createIkenticE2eFixture();
  try {
    return await fn(fixture);
  } finally {
    await fixture.cleanup();
  }
}
