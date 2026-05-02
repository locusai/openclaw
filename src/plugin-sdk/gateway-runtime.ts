// Public gateway/client helpers for plugins that talk to the host gateway surface.

export * from "../gateway/channel-status-patches.js";
export { GatewayClient } from "../gateway/client.js";
export {
  createOperatorApprovalsGatewayClient,
  withOperatorApprovalsGatewayClient,
} from "../gateway/operator-approvals-client.js";
export {
  classifyGatewayConnectFailure,
  ConnectErrorDetailCodes as GATEWAY_CONNECT_DETAIL_CODES,
  ConnectPairingRequiredReasons as GATEWAY_CONNECT_PAIRING_REQUIRED_REASONS,
  formatConnectErrorMessage,
  readConnectErrorDetailCode,
  readConnectErrorRecoveryAdvice,
  readConnectPairingRequiredDetails,
  readConnectPairingRequiredMessage,
  readPairingConnectErrorDetails,
} from "../gateway/protocol/connect-error-details.js";
export type {
  ConnectErrorDetailCode as GatewayConnectDetailCode,
  ConnectErrorRecoveryAdvice as GatewayConnectRecoveryAdvice,
  ConnectPairingRequiredDetails as GatewayPairingRequiredDetails,
  ConnectPairingRequiredReason as GatewayConnectPairingRequiredReason,
  GatewayConnectFailure,
  GatewayConnectFailureInput,
  GatewayConnectSnapshot,
  PairingConnectErrorDetails as GatewayPairingConnectErrorDetails,
} from "../gateway/protocol/connect-error-details.js";
export type { EventFrame } from "../gateway/protocol/index.js";
export type { GatewayRequestHandlerOptions } from "../gateway/server-methods/types.js";
