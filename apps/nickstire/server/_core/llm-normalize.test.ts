import { describe, it, expect } from "vitest";
import { normalizeMessage, type Message, type ToolCall } from "./llm";

const TC: ToolCall = {
  id: "call_abc",
  type: "function",
  function: { name: "get_pricing", arguments: '{"service":"brakes"}' },
};

describe("normalizeMessage · tool_calls preservation", () => {
  // Regression: an assistant message that issued tool calls MUST carry
  // `tool_calls` back to the API. Dropping it orphaned the following
  // `tool` result messages → the model re-called the same tool every
  // loop iteration → the customer chat exhausted to "glitching out".
  it("preserves tool_calls on an assistant message", () => {
    const msg: Message = { role: "assistant", content: "", tool_calls: [TC] };
    const out = normalizeMessage(msg) as Record<string, unknown>;
    expect(out.tool_calls).toEqual([TC]);
    expect(out.role).toBe("assistant");
  });

  it("does not add tool_calls to plain assistant/user messages", () => {
    const out = normalizeMessage({ role: "user", content: "hi" }) as Record<string, unknown>;
    expect("tool_calls" in out).toBe(false);
    expect(out.content).toBe("hi");
  });

  it("keeps the tool result shape (role/tool_call_id/name/content)", () => {
    const out = normalizeMessage({
      role: "tool",
      content: "42",
      tool_call_id: "call_abc",
      name: "get_pricing",
    }) as Record<string, unknown>;
    expect(out).toMatchObject({ role: "tool", tool_call_id: "call_abc", name: "get_pricing", content: "42" });
    expect("tool_calls" in out).toBe(false);
  });
});
