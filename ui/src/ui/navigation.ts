import type { IconName } from "./icons.js";

export const TAB_GROUPS = [
  { label: "Chat", tabs: ["chat"] },
  {
    label: "Control",
    tabs: ["overview", "channels", "instances", "sessions", "usage", "cron"],
  },
  { label: "Agent", tabs: ["agents", "skills", "nodes"] },
  { label: "Settings", tabs: ["config", "debug", "logs"] },
] as const;

export type CoreTab =
  | "agents"
  | "overview"
  | "channels"
  | "instances"
  | "sessions"
  | "usage"
  | "cron"
  | "skills"
  | "nodes"
  | "chat"
  | "config"
  | "debug"
  | "logs";

const PLUGIN_TAB_PREFIX = "plugin:" as const;
const PLUGIN_ROUTE_PREFIX = "/plugin/" as const;

export type PluginTab = `${typeof PLUGIN_TAB_PREFIX}${string}`;
export type Tab = CoreTab | PluginTab;

export function pluginTabFromId(id: string): PluginTab {
  return `${PLUGIN_TAB_PREFIX}${id}`;
}

export function pluginIdFromTab(tab: Tab): string | null {
  if (typeof tab !== "string" || !tab.startsWith(PLUGIN_TAB_PREFIX)) {
    return null;
  }
  const id = tab.slice(PLUGIN_TAB_PREFIX.length).trim();
  return id || null;
}

export function isPluginTab(tab: Tab): tab is PluginTab {
  return pluginIdFromTab(tab) !== null;
}

const TAB_PATHS: Record<CoreTab, string> = {
  agents: "/agents",
  overview: "/overview",
  channels: "/channels",
  instances: "/instances",
  sessions: "/sessions",
  usage: "/usage",
  cron: "/cron",
  skills: "/skills",
  nodes: "/nodes",
  chat: "/chat",
  config: "/config",
  debug: "/debug",
  logs: "/logs",
};

const PATH_TO_TAB = new Map(Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as CoreTab]));

export function normalizeBasePath(basePath: string): string {
  if (!basePath) {
    return "";
  }
  let base = basePath.trim();
  if (!base.startsWith("/")) {
    base = `/${base}`;
  }
  if (base === "/") {
    return "";
  }
  if (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  return base;
}

export function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }
  let normalized = path.trim();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function pathForTab(tab: Tab, basePath = ""): string {
  const extensionId = pluginIdFromTab(tab);
  if (extensionId) {
    const encoded = encodeURIComponent(extensionId);
    const extensionPath = `${PLUGIN_ROUTE_PREFIX}${encoded}`;
    const base = normalizeBasePath(basePath);
    return base ? `${base}${extensionPath}` : extensionPath;
  }
  const base = normalizeBasePath(basePath);
  const path = TAB_PATHS[tab as CoreTab];
  return base ? `${base}${path}` : path;
}

export function tabFromPath(pathname: string, basePath = ""): Tab | null {
  const base = normalizeBasePath(basePath);
  let path = pathname || "/";
  if (base) {
    if (path === base) {
      path = "/";
    } else if (path.startsWith(`${base}/`)) {
      path = path.slice(base.length);
    }
  }
  const normalizedPath = normalizePath(path);
  const normalizedNoIndex = normalizedPath.toLowerCase().endsWith("/index.html")
    ? "/"
    : normalizedPath;
  const normalizedLower = normalizedNoIndex.toLowerCase();
  if (normalizedLower === "/") {
    return "chat";
  }
  if (normalizedLower.startsWith(PLUGIN_ROUTE_PREFIX)) {
    const raw = normalizedPath.slice(PLUGIN_ROUTE_PREFIX.length);
    const firstSegment = raw.split("/")[0] ?? "";
    if (!firstSegment) {
      return null;
    }
    try {
      const decoded = decodeURIComponent(firstSegment).trim();
      if (!decoded) {
        return null;
      }
      return pluginTabFromId(decoded);
    } catch {
      return null;
    }
  }
  return PATH_TO_TAB.get(normalizedLower) ?? null;
}

export function inferBasePathFromPathname(pathname: string): string {
  let normalized = normalizePath(pathname);
  if (normalized.endsWith("/index.html")) {
    normalized = normalizePath(normalized.slice(0, -"/index.html".length));
  }
  if (normalized === "/") {
    return "";
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }
  for (let i = 0; i < segments.length; i++) {
    const candidate = `/${segments.slice(i).join("/")}`.toLowerCase();
    if (PATH_TO_TAB.has(candidate)) {
      const prefix = segments.slice(0, i);
      return prefix.length ? `/${prefix.join("/")}` : "";
    }
    if (candidate.startsWith(PLUGIN_ROUTE_PREFIX)) {
      const suffix = candidate.slice(PLUGIN_ROUTE_PREFIX.length);
      if (suffix) {
        const prefix = segments.slice(0, i);
        return prefix.length ? `/${prefix.join("/")}` : "";
      }
    }
  }
  return `/${segments.join("/")}`;
}

export function iconForTab(tab: Tab): IconName {
  if (isPluginTab(tab)) {
    return "puzzle";
  }
  switch (tab) {
    case "agents":
      return "folder";
    case "chat":
      return "messageSquare";
    case "overview":
      return "barChart";
    case "channels":
      return "link";
    case "instances":
      return "radio";
    case "sessions":
      return "fileText";
    case "usage":
      return "barChart";
    case "cron":
      return "loader";
    case "skills":
      return "zap";
    case "nodes":
      return "monitor";
    case "config":
      return "settings";
    case "debug":
      return "bug";
    case "logs":
      return "scrollText";
    default:
      return "folder";
  }
}

export function titleForTab(tab: Tab) {
  if (isPluginTab(tab)) {
    return "Plugin";
  }
  switch (tab) {
    case "agents":
      return "Agents";
    case "overview":
      return "Overview";
    case "channels":
      return "Channels";
    case "instances":
      return "Instances";
    case "sessions":
      return "Sessions";
    case "usage":
      return "Usage";
    case "cron":
      return "Cron Jobs";
    case "skills":
      return "Skills";
    case "nodes":
      return "Nodes";
    case "chat":
      return "Chat";
    case "config":
      return "Config";
    case "debug":
      return "Debug";
    case "logs":
      return "Logs";
    default:
      return "Control";
  }
}

export function subtitleForTab(tab: Tab) {
  if (isPluginTab(tab)) {
    return "Plugin UI.";
  }
  switch (tab) {
    case "agents":
      return "Manage agent workspaces, tools, and identities.";
    case "overview":
      return "Gateway status, entry points, and a fast health read.";
    case "channels":
      return "Manage channels and settings.";
    case "instances":
      return "Presence beacons from connected clients and nodes.";
    case "sessions":
      return "Inspect active sessions and adjust per-session defaults.";
    case "usage":
      return "";
    case "cron":
      return "Schedule wakeups and recurring agent runs.";
    case "skills":
      return "Manage skill availability and API key injection.";
    case "nodes":
      return "Paired devices, capabilities, and command exposure.";
    case "chat":
      return "Direct gateway chat session for quick interventions.";
    case "config":
      return "Edit ~/.openclaw/openclaw.json safely.";
    case "debug":
      return "Gateway snapshots, events, and manual RPC calls.";
    case "logs":
      return "Live tail of the gateway file logs.";
    default:
      return "";
  }
}
