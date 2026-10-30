/**
 * tests/ai/chat/text-only-stray-calls.test.ts · 2026-10-30 (bdnick "a few errors")
 *
 * THE DEFECT, measured in prod 13:00-14:05Z: the last step of a turn sends no tools
 * (text-only-step.ts), but ollama/minimax-m3 still calls them. The SDK refuses each
 * call with NoSuchToolError and an EMPTY availableTools list ("Available tools: .").
 * 12 of 16 tool failures that morning were these. The calls never ran, yet they were
 * recorded as FAILED operations: tool_telemetry failures (the breaker's input), failed
 * receipts, and a failed read the claim check turned into the fabrication banner on a
 * reply whose same reads had succeeded earlier in the turn (14:03Z). The repair hook
 * also rerouted a pruned one to invokeTool, which failed the same way and was logged
 * under the wrong tool.
 *
 * THE RULE: a call refused because the step offered NO tools did not run. It is not a
 * failure, not a receipt, not a breaker count. CONTROLS: a hallucinated name on a step
 * that offered tools stays a failure; a tool that ran and returned { error } stays a
 * failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NoSuchToolError, type ToolSet } from "ai";

const recordToolInvocation = vi.fn(async (_row: Record<string, unknown>) => undefined);
vi.mock("@/lib/ai/tool-telemetry", () => ({
  recordToolInvocation: (row: Record<string, unknown>) => recordToolInvocation(row),
  isConfigurationError: () => false,
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: () => undefined }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { normalizeAiSdkToolObservations } from "@/lib/ai/chat/ai-sdk-tool-observation";
import { recordToolObservations } from "@/lib/services/chat/tool-telemetry-walk";
import { buildRepairToolCall } from "@/lib/ai/chat/repair-tool-call";

/** One step the way AI SDK 6 records an invalid call: an invalid tool-call part and its tool-error part. */
function refusedStep(toolName: string, availableTools: string[]) {
  const error = new NoSuchToolError({ toolName, availableTools });
  return {
    toolCalls: [{ type: "tool-call", toolCallId: `tc-${toolName}`, toolName, input: {}, dynamic: true, invalid: true, error }],
    toolResults: [],
    content: [
      { type: "tool-call", toolCallId: `tc-${toolName}`, toolName, input: {}, dynamic: true, invalid: true, error },
      { type: "tool-error", toolCallId: `tc-${toolName}`, toolName, input: {}, error, dynamic: true },
    ],
  };
}

const ranStep = {
  toolCalls: [{ type: "tool-call", toolCallId: "tc-ok", toolName: "searchMemories", input: { query: "q" } }],
  toolResults: [{ type: "tool-result", toolCallId: "tc-ok", toolName: "searchMemories", input: { query: "q" }, output: { hits: 3 } }],
  content: [],
};

beforeEach(() => recordToolInvocation.mockClear());

describe("a call refused on a step that offered no tools did not run", () => {
  it("is marked notRun by the observation seam", () => {
    const obs = normalizeAiSdkToolObservations({ steps: [refusedStep("searchMemories", [])] });
    expect(obs).toHaveLength(1);
    expect(obs[0]).toEqual(expect.objectContaining({ toolName: "searchMemories", notRun: true }));
  });

  it("CONTROL: a hallucinated name on a step that offered tools is still a failure, not notRun", () => {
    const [obs] = normalizeAiSdkToolObservations({ steps: [refusedStep("memory.remember", ["searchMemories"])] });
    expect(obs.notRun).toBeFalsy();
    expect(obs.error).toBeTruthy();
  });

  it("is no telemetry row (the breaker's input) but stays a captured call marked notRun (the 14:03Z turn shape)", () => {
    const captured = recordToolObservations({ steps: [ranStep, refusedStep("searchMemories", []), refusedStep("searchColdMemory", [])] }, "conv-1");
    expect(captured.map((c) => [c.name, c.ok, c.notRun === true])).toEqual([
      ["searchMemories", true, false],
      ["searchMemories", false, true],
      ["searchColdMemory", false, true],
    ]);
    expect(recordToolInvocation).toHaveBeenCalledTimes(1);
    expect(recordToolInvocation.mock.calls[0][0]).toEqual(expect.objectContaining({ toolName: "searchMemories", success: true }));
  });

  // Second reader P1 (2026-10-30): dropping the call hid the ONLY evidence that a stated result
  // had no read behind it. The not-run read must still reach the claim check.
  it("POSITIVE CONTROL: a result stated from a read that never ran still gets the banner", async () => {
    const { verifyEnvironmentState } = await import("@/lib/ai/chat/environment-verifier");
    const { envFailureClaims } = await import("@/lib/ai/chat/action-claim-detector");
    const stray = {
      ...refusedStep("searchMemories", []),
    };
    stray.toolCalls[0].input = { query: "sleep streak" } as never;
    stray.content[1].input = { query: "sleep streak" } as never;
    const captured = recordToolObservations({ steps: [stray] }, "conv-1");
    const checks = await verifyEnvironmentState(captured);
    const claims = envFailureClaims(checks, "Your sleep streak is five days.", {
      calls: captured,
      isRead: (n) => n === "searchMemories",
    });
    expect(claims).toHaveLength(1);
  });

  it("CONTROL: a tool that ran and returned { error } is still a failed call and a failed telemetry row", () => {
    const softFail = {
      toolCalls: [{ type: "tool-call", toolCallId: "tc-x", toolName: "invokeTool", input: { name: "getBlindSpots" } }],
      toolResults: [{ type: "tool-result", toolCallId: "tc-x", toolName: "invokeTool", input: { name: "getBlindSpots" }, output: { error: "boom" } }],
      content: [],
    };
    const captured = recordToolObservations({ steps: [softFail] }, "conv-1");
    expect(captured.map((c) => [c.name, c.ok])).toEqual([["invokeTool", false]]);
    expect(recordToolInvocation.mock.calls[0][0]).toEqual(expect.objectContaining({ toolName: "invokeTool", success: false }));
  });
});

describe("the repair hook does not reroute a call made on a step with no tools", () => {
  const KNOWN = new Set(["searchColdMemory", "invokeTool"]);
  const toolSet = { invokeTool: {} } as unknown as ToolSet;
  const run = (availableTools: string[]) =>
    buildRepairToolCall(toolSet, KNOWN)({
      toolCall: { type: "tool-call", toolCallId: "tc-1", toolName: "searchColdMemory", input: "{}" },
      error: new NoSuchToolError({ toolName: "searchColdMemory", availableTools }),
      tools: toolSet,
      inputSchema: (() => ({})) as never,
      messages: [],
      system: undefined,
    } as never);

  it("returns null when the step offered no tools", async () => {
    expect(await run([])).toBeNull();
  });

  it("CONTROL: still routes a pruned real tool through invokeTool on a step that offers it", async () => {
    const repaired = (await run(["invokeTool"])) as { toolName: string } | null;
    expect(repaired?.toolName).toBe("invokeTool");
  });
});
