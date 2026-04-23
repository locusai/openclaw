import { logVerbose } from "../../globals.js";
import { executePluginCommandOptions } from "../../plugins/command-options.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import { shouldHandleTextCommands } from "../commands-registry.js";
import { emitResetCommandHooks } from "./commands-reset-hooks.js";
import { maybeHandleResetCommand } from "./commands-reset.js";
import type {
  CommandHandler,
  CommandHandlerResult,
  HandleCommandsParams,
} from "./commands-types.js";
export { emitResetCommandHooks } from "./commands-reset-hooks.js";
let commandHandlersRuntimePromise: Promise<typeof import("./commands-handlers.runtime.js")> | null =
  null;

function loadCommandHandlersRuntime() {
  commandHandlersRuntimePromise ??= import("./commands-handlers.runtime.js");
  return commandHandlersRuntimePromise;
}

let HANDLERS: CommandHandler[] | null = null;

export async function handleCommands(params: HandleCommandsParams): Promise<CommandHandlerResult> {
  if (HANDLERS === null) {
    HANDLERS = (await loadCommandHandlersRuntime()).loadCommandHandlers();
  }
  const allowTextCommands = shouldHandleTextCommands({
    cfg: params.cfg,
    surface: params.command.surface,
    commandSource: params.ctx.CommandSource,
  });

  if (allowTextCommands) {
    const optionResult = await executePluginCommandOptions({
      commandBody: params.command.commandBodyNormalized,
      sessionKey: params.sessionKey,
      sessionId: params.sessionEntry?.sessionId,
      senderId: params.command.senderId,
      channel: params.command.channel,
      channelId: params.command.channelId,
      isAuthorizedSender: params.command.isAuthorizedSender,
      config: params.cfg,
      from: params.command.from,
      to: params.command.to,
      accountId: params.ctx.AccountId ?? undefined,
      messageThreadId:
        typeof params.ctx.MessageThreadId === "number" ? params.ctx.MessageThreadId : undefined,
    });
    if (optionResult.commandBody !== params.command.commandBodyNormalized) {
      params.command.commandBodyNormalized = optionResult.commandBody;
    }
    if (optionResult.shouldStop) {
      return {
        shouldContinue: false,
        ...(optionResult.reply ? { reply: optionResult.reply } : {}),
      };
    }
  }

  const resetResult = await maybeHandleResetCommand(params);
  if (resetResult) {
    return resetResult;
  }

  for (const handler of HANDLERS) {
    const result = await handler(params, allowTextCommands);
    if (result) {
      return result;
    }
  }

  const targetSessionEntry = params.sessionStore?.[params.sessionKey] ?? params.sessionEntry;
  const sendPolicy = resolveSendPolicy({
    cfg: params.cfg,
    entry: targetSessionEntry,
    sessionKey: params.sessionKey,
    channel: targetSessionEntry?.channel ?? params.command.channel,
    chatType: targetSessionEntry?.chatType,
  });
  if (sendPolicy === "deny") {
    logVerbose(`Send blocked by policy for session ${params.sessionKey ?? "unknown"}`);
    return { shouldContinue: false };
  }

  return { shouldContinue: true };
}
