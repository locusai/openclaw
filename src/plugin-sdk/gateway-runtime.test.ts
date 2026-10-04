import {
  GATEWAY_CONNECT_DETAIL_CODES,
  GATEWAY_CONNECT_PAIRING_REQUIRED_REASONS,
  classifyGatewayConnectFailure,
} from "openclaw/plugin-sdk/gateway-runtime";
import { describe, expect, it } from "vitest";

describe("plugin-sdk gateway-runtime", () => {
  it("classifies token failures", () => {
    expect(
      classifyGatewayConnectFailure({
        error: new Error("unauthorized: gateway token mismatch"),
      }),
    ).toEqual({
      kind: "token",
      code: GATEWAY_CONNECT_DETAIL_CODES.AUTH_TOKEN_MISMATCH,
      message: "unauthorized: gateway token mismatch",
    });
  });

  it("classifies origin failures", () => {
    expect(
      classifyGatewayConnectFailure({
        error: new Error("origin not allowed"),
      }),
    ).toEqual({
      kind: "origin",
      code: GATEWAY_CONNECT_DETAIL_CODES.CONTROL_UI_ORIGIN_NOT_ALLOWED,
      message: "origin not allowed",
    });
  });

  it("classifies pairing failures with request and device ids", () => {
    expect(
      classifyGatewayConnectFailure({
        error: new Error("pairing required"),
        details: {
          code: GATEWAY_CONNECT_DETAIL_CODES.PAIRING_REQUIRED,
          reason: GATEWAY_CONNECT_PAIRING_REQUIRED_REASONS.SCOPE_UPGRADE,
          requestId: "pair-1",
          deviceId: "device-1",
        },
      }),
    ).toEqual({
      kind: "pairing",
      code: GATEWAY_CONNECT_DETAIL_CODES.PAIRING_REQUIRED,
      reason: GATEWAY_CONNECT_PAIRING_REQUIRED_REASONS.SCOPE_UPGRADE,
      requestId: "pair-1",
      deviceId: "device-1",
      message: "pairing required",
    });
  });

  it("classifies unknown failures", () => {
    expect(
      classifyGatewayConnectFailure({
        error: new Error("something else"),
      }),
    ).toMatchObject({
      kind: "unknown",
      message: "something else",
      error: expect.any(Error),
    });
  });

  it("does not classify device-token mismatch as token", () => {
    const failure = classifyGatewayConnectFailure({
      error: new Error("unauthorized: device token mismatch"),
    });

    expect(failure.kind).not.toBe("token");
    expect(failure).toMatchObject({
      kind: "unknown",
      code: GATEWAY_CONNECT_DETAIL_CODES.AUTH_DEVICE_TOKEN_MISMATCH,
    });
  });

  it("has no policy side effects", () => {
    const details = Object.freeze({
      code: GATEWAY_CONNECT_DETAIL_CODES.PAIRING_REQUIRED,
      requestId: "pair-2",
    });
    const snapshot = Object.freeze({
      accessState: details,
      deviceId: "device-2",
      connection: Object.freeze({ requestedScopes: Object.freeze(["operator.read"]) }),
    });

    const failure = classifyGatewayConnectFailure({
      error: new Error("pairing required"),
      details,
      snapshot,
    });

    expect(failure.kind).toBe("pairing");
    expect(snapshot.connection.requestedScopes).toEqual(["operator.read"]);
  });

  it("classifies source-known transport failures as unavailable", () => {
    expect(
      classifyGatewayConnectFailure({
        error: new Error("connect ECONNREFUSED 127.0.0.1:18789"),
      }),
    ).toMatchObject({
      kind: "unavailable",
      message: "connect ECONNREFUSED 127.0.0.1:18789",
    });
  });
});
