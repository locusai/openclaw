import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export function parseNewPrintArg(commandBody: string | undefined): string | null {
  const raw = typeof commandBody === "string" ? commandBody.trim() : "";
  if (!raw) {
    return null;
  }

  const inline = raw.match(/^\/new\s+--print=(.+)$/i);
  const spaced = raw.match(/^\/new\s+--print\s+(.+)$/i);
  const value = (inline?.[1] ?? spaced?.[1] ?? "").trim();
  if (!value) {
    return null;
  }

  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  const normalized = quoted ? value.slice(1, -1).trim() : value;
  return normalized || null;
}

export default function registerNewPrintPlugin(api: OpenClawPluginApi) {
  api.registerHook(
    ["command:new"],
    (event) => {
      if (event.type !== "command" || event.action !== "new") {
        return;
      }
      const commandBody =
        event.context && typeof event.context.commandBody === "string"
          ? event.context.commandBody
          : undefined;
      const text = parseNewPrintArg(commandBody);
      if (!text) {
        return;
      }
      return { handled: true, reply: { text } };
    },
    { name: "new-print:command-new" },
  );
}
