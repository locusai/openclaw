/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import { extractToolCards, renderToolCardSidebar } from "./tool-cards.ts";

describe("tool cards", () => {
  it("renders anthropic tool_use input details in tool cards", () => {
    const cards = extractToolCards({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_123",
          name: "Bash",
          input: { command: 'time claude -p "say ok"' },
        },
      ],
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: "call",
      name: "Bash",
      args: { command: 'time claude -p "say ok"' },
    });

    const container = document.createElement("div");
    render(renderToolCardSidebar(cards[0]), container);

    expect(container.textContent).toContain('time claude -p "say ok"');
    expect(container.textContent).toContain("Bash");
  });

  it("suppresses call and empty result cards for suppressWhenNoOutput tools when no result text exists", () => {
    const message = {
      content: [
        { type: "tool_call", name: "ikentic_locus_check_task", arguments: { taskId: "task-1" } },
        { type: "tool_result", name: "ikentic_locus_check_task", content: "" },
      ],
    };

    expect(extractToolCards(message)).toEqual([]);
  });

  it("keeps cards for non-suppressed tools when no result text exists", () => {
    const message = {
      content: [
        { type: "tool_call", name: "search", arguments: {} },
        { type: "tool_result", name: "search", content: "" },
      ],
    };

    expect(extractToolCards(message).map((card) => card.kind)).toEqual(["call", "result"]);
  });

  it("does not suppress when any result has text", () => {
    const message = {
      content: [
        { type: "tool_call", name: "ikentic_locus_check_task", arguments: {} },
        { type: "tool_result", name: "search", content: "ok" },
      ],
    };

    const cards = extractToolCards(message);

    expect(
      cards.some((card) => card.kind === "call" && card.name === "ikentic_locus_check_task"),
    ).toBe(true);
  });
});
