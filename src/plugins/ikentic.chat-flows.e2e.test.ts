import { afterEach, describe, expect, it, vi } from "vitest";
import { wrapToolWithBeforeToolCallHook } from "../agents/pi-tools.before-tool-call.js";
import { executePluginCommand, matchPluginCommand } from "./commands.js";
import { withIkenticE2eFixture } from "./test-utils/ikentic-e2e-fixtures.js";

const SESSION_KEY = "agent:main:main";
const AGENT_ID = "main";
const REDIRECT_URI = "http://127.0.0.1:18789/oauth/callback";

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
});

describe("ikentic chat e2e flows", () => {
  /**
   * Given a user has persona access but no OAuth token
   * When a user runs ikentic_adk_search in chat
   * Then execution is blocked with /ikelogin guidance
   */
  it("blocks ikentic search with explicit login guidance when token is missing", async () => {
    await withIkenticE2eFixture(async (fixture) => {
      const issuer = "https://issuer-login-required.example";
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/.well-known/oauth-authorization-server") && method === "GET") {
          return jsonResponse({
            issuer,
            authorization_endpoint: `${issuer}/oauth/authorize`,
            token_endpoint: `${issuer}/oauth/token`,
            registration_endpoint: `${issuer}/oauth/register`,
          });
        }
        if (url.endsWith("/oauth/register") && method === "POST") {
          return jsonResponse({
            client_id: "client-id",
            client_secret: "client-secret",
            redirect_uris: [REDIRECT_URI],
          });
        }
        throw new Error(`Unexpected fetch call: ${method} ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await fixture.seedPersonaSelection({
        sessionKey: SESSION_KEY,
        toolName: "ikentic_adk_search",
      });
      await fixture.registerIkenticPlugin({ issuer });

      const tool = wrapToolWithBeforeToolCallHook(
        {
          name: "ikentic_adk_search",
          description: "ikentic search",
          parameters: {},
          execute: vi.fn(async () => ({ content: [], details: { ok: true } })),
        } as never,
        { sessionKey: SESSION_KEY, agentId: AGENT_ID },
      );

      await expect(
        tool.execute("tool-call-login-required", { query: "roadmap" }, undefined, undefined),
      ).rejects.toThrow(/\/ikelogin/i);
    });
  });

  /**
   * Given IKENTIC is configured
   * When a user runs /ikelogin
   * Then browser auth instructions are returned
   */
  it("returns login instructions for /ikelogin command", async () => {
    await withIkenticE2eFixture(async (fixture) => {
      const issuer = "https://issuer-login-command.example";
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/.well-known/oauth-authorization-server") && method === "GET") {
          return jsonResponse({
            issuer,
            authorization_endpoint: `${issuer}/oauth/authorize`,
            token_endpoint: `${issuer}/oauth/token`,
            registration_endpoint: `${issuer}/oauth/register`,
          });
        }
        if (url.endsWith("/oauth/register") && method === "POST") {
          return jsonResponse({
            client_id: "client-id",
            client_secret: "client-secret",
            redirect_uris: [REDIRECT_URI],
          });
        }
        throw new Error(`Unexpected fetch call: ${method} ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const config = await fixture.registerIkenticPlugin({ issuer });
      const matched = matchPluginCommand("/ikelogin");
      if (!matched) {
        throw new Error("expected /ikelogin command to be registered");
      }

      const result = await executePluginCommand({
        command: matched.command,
        args: matched.args,
        senderId: "user-123",
        channel: "webchat",
        isAuthorizedSender: true,
        commandBody: "/ikelogin",
        config,
      });

      expect(result.text).toContain("Authorize in browser");
      expect(result.text).toContain("/ikelogin REDIRECT_URL");
    });
  });

  /**
   * Given persona and OAuth token exist
   * When a user runs ikentic_adk_search in chat
   * Then before-tool governance permits execution
   */
  it("allows ikentic search execution when persona policy and OAuth token are present", async () => {
    await withIkenticE2eFixture(async (fixture) => {
      const issuer = "https://issuer-search-ok.example";
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.endsWith("/api/ferb-jwt")) {
          return jsonResponse({ token: "ferb-jwt" });
        }
        throw new Error(`Unexpected fetch call: GET ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await fixture.seedPersonaSelection({
        sessionKey: SESSION_KEY,
        toolName: "ikentic_adk_search",
      });
      await fixture.seedOAuthToken();
      await fixture.registerIkenticPlugin({ issuer });

      const execute = vi.fn(async () => ({ content: [], details: { ok: true } }));
      const tool = wrapToolWithBeforeToolCallHook(
        {
          name: "ikentic_adk_search",
          description: "ikentic search",
          parameters: {},
          execute,
        } as never,
        { sessionKey: SESSION_KEY, agentId: AGENT_ID },
      );

      await tool.execute("tool-call-search-ok", { query: "status report" }, undefined, undefined);

      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith(
        "tool-call-search-ok",
        { query: "status report" },
        undefined,
        undefined,
      );
    });
  });
});
