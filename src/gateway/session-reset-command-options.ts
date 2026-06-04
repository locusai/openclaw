import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  executePluginCommandOptions,
  stripPluginCommandOptionsFromBody,
  type ExecutePluginCommandOptionsResult,
} from "../plugins/command-options.js";
import type { PluginCommandOptionPhase } from "../plugins/types.js";
import {
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
} from "../shared/string-coerce.js";
import {
  INTERNAL_MESSAGE_CHANNEL,
  normalizeMessageChannel,
  type GatewayMessageChannel,
} from "../utils/message-channel.js";

export const RESET_COMMAND_RE = /^\/(new|reset)(?:\s+([\s\S]*))?$/i;

export type ResetCommandReason = "new" | "reset";

export type ResetCommandRequestContext = {
  channel?: string;
  replyChannel?: string;
  accountId?: string;
  threadId?: string;
  replyTo?: string;
  to?: string;
};

export type ParsedResetCommandBody = {
  commandBody: string;
  reason: ResetCommandReason;
  tail: string;
};

export function parseResetCommandBody(commandBody: string): ParsedResetCommandBody | null {
  const normalized = normalizeOptionalString(commandBody);
  if (!normalized) {
    return null;
  }
  const match = normalized.match(RESET_COMMAND_RE);
  if (!match) {
    return null;
  }
  return {
    commandBody: normalized,
    reason: normalizeOptionalLowercaseString(match[1]) === "reset" ? "reset" : "new",
    tail: normalizeOptionalString(match[2]) ?? "",
  };
}

export function isResetCommandBody(commandBody: string): boolean {
  return parseResetCommandBody(commandBody) !== null;
}

export function stripAndParseResetCommandBody(commandBody: string): ParsedResetCommandBody | null {
  const stripped = stripPluginCommandOptionsFromBody({ commandBody }).commandBody.trim();
  return parseResetCommandBody(stripped || commandBody.trim());
}

export async function executeResetCommandOptions(params: {
  commandBody: string;
  phase: PluginCommandOptionPhase;
  sessionKey: string;
  sessionId?: string;
  cfg: OpenClawConfig;
  request?: ResetCommandRequestContext;
  senderId?: string;
  channel?: GatewayMessageChannel;
  channelId?: string;
}): Promise<ExecutePluginCommandOptionsResult> {
  const request = params.request;
  const channel =
    params.channel ??
    normalizeMessageChannel(request?.channel?.trim()) ??
    normalizeMessageChannel(request?.replyChannel?.trim()) ??
    INTERNAL_MESSAGE_CHANNEL;
  const threadId =
    typeof request?.threadId === "string" && request.threadId.trim()
      ? Number(request.threadId)
      : undefined;
  return executePluginCommandOptions({
    commandBody: params.commandBody,
    phase: params.phase,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    senderId: params.senderId,
    channel,
    channelId: params.channelId ?? channel,
    isAuthorizedSender: true,
    config: params.cfg,
    from: normalizeOptionalString(request?.replyTo),
    to: normalizeOptionalString(request?.to),
    accountId: normalizeOptionalString(request?.accountId),
    messageThreadId: Number.isFinite(threadId) ? threadId : undefined,
  });
}
