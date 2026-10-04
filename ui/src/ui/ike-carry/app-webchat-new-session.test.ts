/* @vitest-environment jsdom */

import { beforeAll, describe, expect, it, vi } from "vitest";

const { createChatSessionMock, handleConnectedMock } = vi.hoisted(() => ({
  createChatSessionMock: vi.fn(),
  handleConnectedMock: vi.fn(),
}));

vi.mock("../app-render.helpers.ts", async () => {
  const actual = await vi.importActual<typeof import("../app-render.helpers.ts")>(
    "../app-render.helpers.ts",
  );
  return {
    ...actual,
    createChatSession: (...args: unknown[]) => createChatSessionMock(...args),
  };
});

vi.mock("../app-lifecycle.ts", async () => {
  const actual = await vi.importActual<typeof import("../app-lifecycle.ts")>("../app-lifecycle.ts");
  return {
    ...actual,
    handleConnected: (...args: unknown[]) => handleConnectedMock(...args),
  };
});

let OpenClawApp: typeof import("../app.ts").OpenClawApp;

async function loadApp(): Promise<void> {
  ({ OpenClawApp } = await import("../app.ts"));
}

describe("webchat new session", () => {
  beforeAll(async () => {
    await loadApp();
  });

  it("routes bare /new from the app slash-action handler to createChatSession", async () => {
    const app = document.createElement("openclaw-app") as InstanceType<typeof OpenClawApp>;
    (app as unknown as { initWebPushState: () => Promise<void> }).initWebPushState = vi.fn(
      async () => undefined,
    );

    app.connectedCallback();
    await app.onSlashAction?.("new-session");

    expect(handleConnectedMock).toHaveBeenCalledTimes(1);
    expect(createChatSessionMock).toHaveBeenCalledTimes(1);
    expect(createChatSessionMock).toHaveBeenCalledWith(app);
  });
});
