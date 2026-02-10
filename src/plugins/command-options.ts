import type { ReplyPayload } from "../auto-reply/types.js";
import type { ChannelId } from "../channels/plugins/types.js";
import type { OpenClawConfig } from "../config/config.js";
import type {
  OpenClawPluginCommandOptionDefinition,
  PluginCommandOptionContext,
  PluginCommandOptionHandlerResult,
  PluginCommandOptionInvocation,
} from "./types.js";
import { logVerbose } from "../globals.js";

type RegisteredPluginCommandOption = {
  pluginId: string;
  command: string;
  option: string;
  aliases: string[];
  takesValue: boolean;
  namespace?: string;
  namespaceAliases: string[];
  consume: boolean;
  requireAuth: boolean;
  definition: OpenClawPluginCommandOptionDefinition;
};

type ParsedOptionToken = {
  name: string;
  presentAs: string;
  value?: string;
  tokenIndex: number;
  candidateValueTokenIndex?: number;
};

type ParsedPositionToken = {
  value: string;
  tokenIndex: number;
};

const commandOptionsByCommand = new Map<string, RegisteredPluginCommandOption[]>();
const commandOptionKeys = new Map<string, RegisteredPluginCommandOption>();
let registryLocked = false;

const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;
const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export type CommandOptionRegistrationResult = {
  ok: boolean;
  error?: string;
};

export type ExecutePluginCommandOptionsResult = {
  matched: boolean;
  shouldStop: boolean;
  reply?: ReplyPayload;
  commandBody: string;
};

function normalizeName(input: string): string {
  return input.trim().toLowerCase();
}

function normalizeCommandName(input: string): string {
  const trimmed = normalizeName(input);
  return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
}

function normalizeNamespace(input: string): string {
  return normalizeName(input);
}

function validateToken(input: string, label: string, pattern: RegExp): string | null {
  if (!input) {
    return `${label} cannot be empty`;
  }
  if (!pattern.test(input)) {
    return `${label} must contain only lowercase letters, numbers, underscores, and hyphens`;
  }
  return null;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (escaping) {
    current += "\\";
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function parseArgTokens(tokens: string[]): {
  options: ParsedOptionToken[];
  positionals: ParsedPositionToken[];
} {
  const options: ParsedOptionToken[] = [];
  const positionals: ParsedPositionToken[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "--") {
      for (let j = i + 1; j < tokens.length; j += 1) {
        positionals.push({ value: tokens[j], tokenIndex: j });
      }
      break;
    }
    if (!token.startsWith("--") || token.length <= 2) {
      positionals.push({ value: token, tokenIndex: i });
      continue;
    }

    const body = token.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex !== -1) {
      const rawName = body.slice(0, eqIndex).trim();
      const value = body.slice(eqIndex + 1);
      if (!rawName) {
        continue;
      }
      options.push({
        name: normalizeName(rawName),
        presentAs: rawName,
        value,
        tokenIndex: i,
      });
      continue;
    }

    const rawName = body.trim();
    if (!rawName) {
      continue;
    }
    const next = tokens[i + 1];
    options.push({
      name: normalizeName(rawName),
      presentAs: rawName,
      tokenIndex: i,
      ...(next && !next.startsWith("--") ? { candidateValueTokenIndex: i + 1 } : {}),
    });
  }

  return { options, positionals };
}

function splitCommandBody(commandBody: string): {
  commandToken: string;
  commandName: string;
  argTokens: string[];
} | null {
  const trimmed = commandBody.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    return null;
  }
  const commandToken = tokens[0];
  if (!commandToken.startsWith("/") || commandToken.length <= 1) {
    return null;
  }
  return {
    commandToken,
    commandName: normalizeCommandName(commandToken),
    argTokens: tokens.slice(1),
  };
}

function matchesNamespace(
  registration: RegisteredPluginCommandOption,
  selectedNamespace: string,
): boolean {
  if (!registration.namespace) {
    return false;
  }
  if (registration.namespace === selectedNamespace) {
    return true;
  }
  return registration.namespaceAliases.includes(selectedNamespace);
}

function resolveOptionRegistration(params: {
  candidates: RegisteredPluginCommandOption[];
  selectedNamespace?: string;
}): RegisteredPluginCommandOption | null {
  const { candidates, selectedNamespace } = params;
  if (candidates.length === 0) {
    return null;
  }
  if (selectedNamespace) {
    const scoped = candidates.filter((candidate) => matchesNamespace(candidate, selectedNamespace));
    if (scoped.length === 1) {
      return scoped[0];
    }
    if (scoped.length > 1) {
      const exact = scoped.filter((candidate) => candidate.namespace === selectedNamespace);
      return exact.length === 1 ? exact[0] : null;
    }
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  const unscoped = candidates.filter((candidate) => !candidate.namespace);
  return unscoped.length === 1 ? unscoped[0] : null;
}

function optionMatchesRegistration(
  optionName: string,
  registration: RegisteredPluginCommandOption,
): boolean {
  if (registration.option === optionName) {
    return true;
  }
  return registration.aliases.includes(optionName);
}

function rebuildCommandBody(
  commandToken: string,
  argTokens: string[],
  consumed: Set<number>,
): string {
  const nextArgs = argTokens.filter((_, index) => !consumed.has(index));
  return nextArgs.length > 0 ? `${commandToken} ${nextArgs.join(" ")}` : commandToken;
}

function resolveOptionValue(
  argTokens: string[],
  option: ParsedOptionToken,
  takesValue: boolean,
): { value?: string; valueTokenIndex?: number } {
  if (option.value != null) {
    return { value: option.value };
  }
  if (!takesValue) {
    return {};
  }
  if (typeof option.candidateValueTokenIndex !== "number") {
    return {};
  }
  const value = argTokens[option.candidateValueTokenIndex];
  return value != null ? { value, valueTokenIndex: option.candidateValueTokenIndex } : {};
}

export function clearPluginCommandOptions(): void {
  commandOptionsByCommand.clear();
  commandOptionKeys.clear();
}

export function registerPluginCommandOption(
  pluginId: string,
  definition: OpenClawPluginCommandOptionDefinition,
): CommandOptionRegistrationResult {
  if (registryLocked) {
    return {
      ok: false,
      error: "Cannot register command options while command processing is in progress",
    };
  }
  if (typeof definition.handler !== "function") {
    return { ok: false, error: "Command option handler must be a function" };
  }

  const command = normalizeCommandName(definition.command);
  const commandValidationError = validateToken(command, "command", NAME_PATTERN);
  if (commandValidationError) {
    return { ok: false, error: commandValidationError };
  }

  const option = normalizeName(definition.option);
  const optionValidationError = validateToken(option, "option", NAME_PATTERN);
  if (optionValidationError) {
    return { ok: false, error: optionValidationError };
  }

  const aliases = Array.from(
    new Set((definition.aliases ?? []).map(normalizeName).filter(Boolean)),
  ).filter((alias) => alias !== option);
  for (const alias of aliases) {
    const aliasError = validateToken(alias, "alias", NAME_PATTERN);
    if (aliasError) {
      return { ok: false, error: aliasError };
    }
  }

  const namespace = definition.namespace ? normalizeNamespace(definition.namespace) : undefined;
  if (namespace) {
    const namespaceError = validateToken(namespace, "namespace", NAMESPACE_PATTERN);
    if (namespaceError) {
      return { ok: false, error: namespaceError };
    }
  }
  const namespaceAliases = Array.from(
    new Set((definition.namespaceAliases ?? []).map(normalizeNamespace).filter(Boolean)),
  ).filter((alias) => alias !== namespace);
  for (const alias of namespaceAliases) {
    const aliasError = validateToken(alias, "namespace alias", NAMESPACE_PATTERN);
    if (aliasError) {
      return { ok: false, error: aliasError };
    }
  }

  const keyScope = namespace ?? "*";
  for (const optionName of [option, ...aliases]) {
    const key = `${command}|${keyScope}|${optionName}`;
    if (commandOptionKeys.has(key)) {
      const existing = commandOptionKeys.get(key)!;
      return {
        ok: false,
        error: `Command option "${command} --${optionName}" already registered by plugin "${existing.pluginId}"`,
      };
    }
  }

  const registration: RegisteredPluginCommandOption = {
    pluginId,
    command,
    option,
    aliases,
    takesValue: definition.takesValue === true,
    namespace,
    namespaceAliases,
    consume: definition.consume !== false,
    requireAuth: definition.requireAuth !== false,
    definition,
  };

  for (const optionName of [option, ...aliases]) {
    const key = `${command}|${keyScope}|${optionName}`;
    commandOptionKeys.set(key, registration);
  }

  const current = commandOptionsByCommand.get(command) ?? [];
  current.push(registration);
  commandOptionsByCommand.set(command, current);
  logVerbose(
    `Registered plugin command option: /${command} --${option}${namespace ? ` (namespace: ${namespace})` : ""} (plugin: ${pluginId})`,
  );
  return { ok: true };
}

export async function executePluginCommandOptions(params: {
  commandBody: string;
  senderId?: string;
  channel: string;
  channelId?: ChannelId;
  isAuthorizedSender: boolean;
  config: OpenClawConfig;
  from?: string;
  to?: string;
  accountId?: string;
  messageThreadId?: number;
}): Promise<ExecutePluginCommandOptionsResult> {
  const parsed = splitCommandBody(params.commandBody);
  if (!parsed) {
    return {
      matched: false,
      shouldStop: false,
      commandBody: params.commandBody,
    };
  }

  const registrations = commandOptionsByCommand.get(parsed.commandName);
  if (!registrations || registrations.length === 0) {
    return {
      matched: false,
      shouldStop: false,
      commandBody: params.commandBody,
    };
  }

  const { options, positionals } = parseArgTokens(parsed.argTokens);
  const consumedTokenIndexes = new Set<number>();

  let selectedNamespace: string | undefined;
  const pluginSelector = options.find((option) => option.name === "plugin");
  if (pluginSelector) {
    const pluginSelectorResolved = resolveOptionValue(parsed.argTokens, pluginSelector, true);
    if (pluginSelectorResolved.value) {
      selectedNamespace = normalizeNamespace(pluginSelectorResolved.value);
    }
    consumedTokenIndexes.add(pluginSelector.tokenIndex);
    const pluginValueIndex = pluginSelectorResolved.valueTokenIndex;
    if (typeof pluginValueIndex === "number") {
      consumedTokenIndexes.add(pluginValueIndex);
    }
  }

  if (!selectedNamespace && positionals.length > 0) {
    const firstPositional = normalizeNamespace(positionals[0].value);
    const namespaceKnown = registrations.some((registration) =>
      registration.namespace
        ? registration.namespace === firstPositional ||
          registration.namespaceAliases.includes(firstPositional)
        : false,
    );
    if (namespaceKnown) {
      selectedNamespace = firstPositional;
      consumedTokenIndexes.add(positionals[0].tokenIndex);
    }
  }

  const invocation: PluginCommandOptionInvocation = {
    commandName: parsed.commandName,
    commandBody: params.commandBody,
    namespace: selectedNamespace,
    options: options
      .filter((option) => option.name !== "plugin")
      .map((option) => ({
        name: option.name,
        presentAs: option.presentAs,
        ...(option.value != null ? { value: option.value } : undefined),
      })),
    positionals: positionals
      .filter((positional) => !consumedTokenIndexes.has(positional.tokenIndex))
      .map((positional) => positional.value),
  };

  let matched = false;
  registryLocked = true;
  try {
    for (const optionToken of options) {
      if (optionToken.name === "plugin") {
        continue;
      }
      const candidates = registrations.filter((registration) =>
        optionMatchesRegistration(optionToken.name, registration),
      );
      const registration = resolveOptionRegistration({
        candidates,
        selectedNamespace,
      });
      if (!registration) {
        continue;
      }

      matched = true;
      if (registration.requireAuth && !params.isAuthorizedSender) {
        return {
          matched: true,
          shouldStop: true,
          reply: { text: "⚠️ This command option requires authorization." },
          commandBody: params.commandBody,
        };
      }

      const context: PluginCommandOptionContext = {
        senderId: params.senderId,
        channel: params.channel,
        channelId: params.channelId,
        isAuthorizedSender: params.isAuthorizedSender,
        commandBody: params.commandBody,
        config: params.config,
        from: params.from,
        to: params.to,
        accountId: params.accountId,
        messageThreadId: params.messageThreadId,
        invocation,
        option: {
          name: optionToken.name,
          presentAs: optionToken.presentAs,
          ...(() => {
            const resolved = resolveOptionValue(
              parsed.argTokens,
              optionToken,
              registration.takesValue,
            );
            return resolved.value != null ? { value: resolved.value } : {};
          })(),
        },
      };

      const result = await registration.definition.handler(context);
      const action: PluginCommandOptionHandlerResult =
        result && typeof result === "object" && "action" in result
          ? result
          : { action: "continue" };

      if (registration.consume) {
        consumedTokenIndexes.add(optionToken.tokenIndex);
        const valueTokenIndex = resolveOptionValue(
          parsed.argTokens,
          optionToken,
          registration.takesValue,
        ).valueTokenIndex;
        if (typeof valueTokenIndex === "number") {
          consumedTokenIndexes.add(valueTokenIndex);
        }
      }

      if (action.action === "reply") {
        return {
          matched: true,
          shouldStop: true,
          reply: action.reply,
          commandBody: params.commandBody,
        };
      }
      if (action.action === "silent") {
        return {
          matched: true,
          shouldStop: true,
          commandBody: params.commandBody,
        };
      }
    }
  } finally {
    registryLocked = false;
  }

  const commandBody = rebuildCommandBody(
    parsed.commandToken,
    parsed.argTokens,
    consumedTokenIndexes,
  );
  return {
    matched,
    shouldStop: false,
    commandBody,
  };
}
