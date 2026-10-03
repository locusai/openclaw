import {
  executePluginCommandOptions,
  stripPluginCommandOptionsFromBody,
} from "../../plugins/command-options.js";
import type { PluginCommandOptionPhase } from "../../plugins/types.js";
import { createLazyImportLoader } from "../../shared/lazy-promise.js";
import { shouldHandleTextCommands } from "../commands-registry.js";
import { maybeHandleResetCommand } from "./commands-reset.js";
import type {
  CommandHandler,
  CommandHandlerResult,
  HandleCommandsParams,
} from "./commands-types.js";
const commandHandlersRuntimeLoader = createLazyImportLoader(
  () => import("./commands-handlers.runtime.js"),
);

function loadCommandHandlersRuntime() {
  return commandHandlersRuntimeLoader.load();
}

let HANDLERS: CommandHandler[] | null = null;

function normalizeCommandHandlerResult(result: CommandHandlerResult): CommandHandlerResult {
  if (!result.reply) {
    return result;
  }
  return {
    ...result,
    reply: {
      ...result.reply,
      replyToId: undefined,
      replyToCurrent: false,
    },
  };
}

async function runPluginCommandOptions(params: {
  commandParams: HandleCommandsParams;
  commandBody: string;
  phase: PluginCommandOptionPhase;
}): Promise<CommandHandlerResult | null> {
  const { commandParams, commandBody, phase } = params;
  const optionResult = await executePluginCommandOptions({
    commandBody,
    phase,
    sessionKey: commandParams.sessionKey,
    sessionId: commandParams.sessionEntry?.sessionId,
    senderId: commandParams.command.senderId,
    channel: commandParams.command.channel,
    channelId: commandParams.command.channelId,
    isAuthorizedSender: commandParams.command.isAuthorizedSender,
    config: commandParams.cfg,
    from: commandParams.command.from,
    to: commandParams.command.to,
    accountId: commandParams.ctx.AccountId ?? undefined,
    messageThreadId:
      typeof commandParams.ctx.MessageThreadId === "number"
        ? commandParams.ctx.MessageThreadId
        : undefined,
  });
  if (phase === "before-core" && optionResult.commandBody !== commandBody) {
    commandParams.command.commandBodyNormalized = optionResult.commandBody;
  }
  if (!optionResult.shouldStop) {
    return null;
  }
  return {
    shouldContinue: false,
    ...(optionResult.reply ? { reply: optionResult.reply } : {}),
  };
}

function stripPluginCommandOptionsForCore(params: HandleCommandsParams): void {
  const stripResult = stripPluginCommandOptionsFromBody({
    commandBody: params.command.commandBodyNormalized,
  });
  if (stripResult.commandBody !== params.command.commandBodyNormalized) {
    params.command.commandBodyNormalized = stripResult.commandBody;
  }
}

async function runAfterCorePluginCommandOptions(params: {
  commandParams: HandleCommandsParams;
  commandBody: string;
  allowTextCommands: boolean;
}): Promise<CommandHandlerResult | null> {
  if (!params.allowTextCommands) {
    return null;
  }
  return runPluginCommandOptions({
    commandParams: params.commandParams,
    commandBody: params.commandBody,
    phase: "after-core",
  });
}

export async function handleCommands(params: HandleCommandsParams): Promise<CommandHandlerResult> {
  if (HANDLERS === null) {
    HANDLERS = (await loadCommandHandlersRuntime()).loadCommandHandlers();
  }

  const allowTextCommands = shouldHandleTextCommands({
    cfg: params.cfg,
    surface: params.command.surface,
    commandSource: params.ctx.CommandSource,
  });

  const originalCommandBody = params.command.commandBodyNormalized;

  if (allowTextCommands) {
    const beforeCoreResult = await runPluginCommandOptions({
      commandParams: params,
      commandBody: originalCommandBody,
      phase: "before-core",
    });
    if (beforeCoreResult) {
      return normalizeCommandHandlerResult(beforeCoreResult);
    }
    stripPluginCommandOptionsForCore(params);
  }

  const resetResult = await maybeHandleResetCommand(params);
  if (resetResult || params.command.resetHookTriggered || params.command.softResetTriggered) {
    const afterCoreResult = await runAfterCorePluginCommandOptions({
      commandParams: params,
      commandBody: originalCommandBody,
      allowTextCommands,
    });
    if (afterCoreResult) {
      return normalizeCommandHandlerResult(afterCoreResult);
    }
  }
  if (resetResult) {
    return normalizeCommandHandlerResult(resetResult);
  }

  for (const handler of HANDLERS) {
    const result = await handler(params, allowTextCommands);
    if (result) {
      const afterCoreResult = await runAfterCorePluginCommandOptions({
        commandParams: params,
        commandBody: originalCommandBody,
        allowTextCommands,
      });
      if (afterCoreResult) {
        return normalizeCommandHandlerResult(afterCoreResult);
      }
      return normalizeCommandHandlerResult(result);
    }
  }

  const afterCoreResult = await runAfterCorePluginCommandOptions({
    commandParams: params,
    commandBody: originalCommandBody,
    allowTextCommands,
  });
  if (afterCoreResult) {
    return normalizeCommandHandlerResult(afterCoreResult);
  }

  // sendPolicy "deny" is now handled downstream in dispatch-from-config.ts
  // by suppressing outbound delivery while still allowing the agent to process
  // the inbound message (context, memory, tool calls). See #53328.
  return { shouldContinue: true };
}
