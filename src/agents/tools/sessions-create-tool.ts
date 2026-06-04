import crypto from "node:crypto";
import { Type } from "typebox";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { callGateway } from "../../gateway/call.js";
import { isResetCommandBody } from "../../gateway/session-reset-command-options.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { SESSION_LABEL_MAX_LENGTH } from "../../sessions/session-label.js";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import {
  describeSessionsCreateTool,
  SESSIONS_CREATE_TOOL_DISPLAY_SUMMARY,
} from "../tool-description-presets.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";
import {
  createAgentToAgentPolicy,
  createSessionVisibilityGuard,
  resolveEffectiveSessionToolsVisibility,
  resolveSessionReference,
  resolveSessionToolContext,
  resolveVisibleSessionReference,
} from "./sessions-helpers.js";

const SessionsCreateToolSchema = Type.Object({
  parentSessionKey: Type.String({ minLength: 1 }),
  commandBody: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  label: Type.Optional(Type.String({ minLength: 1, maxLength: SESSION_LABEL_MAX_LENGTH })),
  model: Type.Optional(Type.String({ minLength: 1 })),
});

type GatewayCaller = typeof callGateway;

export function createSessionsCreateTool(opts?: {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  sandboxed?: boolean;
  config?: OpenClawConfig;
  callGateway?: GatewayCaller;
}): AnyAgentTool {
  return {
    label: "Session Create",
    name: "sessions_create",
    displaySummary: SESSIONS_CREATE_TOOL_DISPLAY_SUMMARY,
    description: describeSessionsCreateTool(),
    parameters: SessionsCreateToolSchema,
    execute: async (_toolCallId, args) => {
      const runId = crypto.randomUUID();
      const params = args as Record<string, unknown>;
      const gatewayCall = opts?.callGateway ?? callGateway;
      const parentSessionKey = readStringParam(params, "parentSessionKey", { required: true });
      const commandBody = readStringParam(params, "commandBody");
      if (commandBody && !isResetCommandBody(commandBody)) {
        return jsonResult({
          runId,
          status: "error",
          error: "commandBody must be a /new or /reset command.",
        });
      }

      const { cfg, mainKey, alias, effectiveRequesterKey, restrictToSpawned } =
        resolveSessionToolContext(opts);
      const resolvedParent = await resolveSessionReference({
        sessionKey: parentSessionKey,
        alias,
        mainKey,
        requesterInternalKey: effectiveRequesterKey,
        restrictToSpawned,
      });
      if (!resolvedParent.ok) {
        return jsonResult({
          runId,
          status: resolvedParent.status,
          error: resolvedParent.error,
        });
      }
      const visibleParent = await resolveVisibleSessionReference({
        resolvedSession: resolvedParent,
        requesterSessionKey: effectiveRequesterKey,
        restrictToSpawned,
        visibilitySessionKey: parentSessionKey,
      });
      if (!visibleParent.ok) {
        return jsonResult({
          runId,
          status: visibleParent.status,
          error: visibleParent.error,
          sessionKey: visibleParent.displayKey,
        });
      }

      const a2aPolicy = createAgentToAgentPolicy(cfg);
      const sessionVisibility = resolveEffectiveSessionToolsVisibility({
        cfg,
        sandboxed: opts?.sandboxed === true,
      });
      const visibilityGuard = await createSessionVisibilityGuard({
        action: "create",
        requesterSessionKey: effectiveRequesterKey,
        visibility: sessionVisibility,
        a2aPolicy,
      });
      const access = visibilityGuard.check(visibleParent.key);
      if (!access.allowed) {
        return jsonResult({
          runId,
          status: access.status,
          error: access.error,
          sessionKey: visibleParent.displayKey,
        });
      }

      const agentId = readStringParam(params, "agentId");
      const label = readStringParam(params, "label");
      const model = readStringParam(params, "model");
      const requestParams = {
        parentSessionKey: visibleParent.key,
        emitCommandHooks: true,
        ...(commandBody ? { commandBody } : {}),
        ...(agentId ? { agentId } : {}),
        ...(label ? { label } : {}),
        ...(model ? { model } : {}),
      };
      try {
        const response = await gatewayCall<{
          key?: string;
          sessionId?: string;
          runStarted?: boolean;
        }>({
          method: "sessions.create",
          params: requestParams,
          timeoutMs: 10_000,
        });
        const sessionKey = response?.key ?? visibleParent.key;
        return jsonResult({
          runId,
          status: "created",
          sessionKey,
          key: sessionKey,
          sessionId: response?.sessionId,
          parentSessionKey: visibleParent.displayKey,
          runStarted: response?.runStarted === true,
        });
      } catch (err) {
        return jsonResult({
          runId,
          status: "error",
          error: formatErrorMessage(err),
          sessionKey: visibleParent.displayKey,
        });
      }
    },
  };
}
