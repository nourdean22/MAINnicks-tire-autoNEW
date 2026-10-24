/**
 * The ONE tool_telemetry recorder, and the lane turns that must not double it.
 *
 * tool_telemetry showed 4 tools with a call in 14 days while system_metrics
 * `tool.chosen` showed 17 distinct tools chosen (census 2026-10-23). The regen
 * and self-consistency lanes in `alternate-paths.ts` ran several generations,
 * kept one reply, and handed the persist walk only the winner's tool NAMES.
 * The walk records a call only from a step, so those tools left no row.
 *
 * The fix: `recordToolObservations` is the single recorder. The streaming and
 * pre-flush paths reach it through `walkToolTelemetry` (ev.steps); the sampled
 * lanes call it once per executed sample (tests/ai/chat/
 * alternate-paths-no-mutating-tools.test.ts). The walk never records a lane
 * turn from names, so nothing is recorded twice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordToolInvocation, recordMetric, recordMetricStrict } = vi.hoisted(() => ({
  recordToolInvocation: vi.fn().mockResolvedValue(undefined),
  recordMetric: vi.fn().mockResolvedValue(undefined),
  recordMetricStrict: vi.fn().mockResolvedValue({ id: "metric-row-1" }),
}));

vi.mock("@/lib/ai/tool-telemetry", () => ({
  recordToolInvocation,
  isConfigurationError: () => false,
}));
vi.mock("@/lib/services/metrics", () => ({ recordMetric, recordMetricStrict }));

import { recordToolObservations, walkToolTelemetry } from "@/lib/services/chat/tool-telemetry-walk";

/** One finished SDK step: a call and its returned value. */
function step(toolName: string, output: unknown, id = `tc-${toolName}`) {
  return {
    toolCalls: [{ toolName, toolCallId: id, input: {} }],
    toolResults: [{ toolName, toolCallId: id, output }],
  };
}

beforeEach(() => {
  recordToolInvocation.mockClear();
  recordMetricStrict.mockClear();
});

describe("recordToolObservations", () => {
  it("records each call once with its real outcome and returns the same calls", () => {
    const captured = recordToolObservations(
      { steps: [step("getCommitments", { items: [] }), step("getTodaySchedule", { events: [] })] },
      "c-lane",
    );
    expect(recordToolInvocation.mock.calls.map((c) => c[0].toolName).sort()).toEqual(["getCommitments", "getTodaySchedule"]);
    expect(recordToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "getCommitments", success: true, conversationId: "c-lane" }),
    );
    expect(captured.map((c) => c.name).sort()).toEqual(["getCommitments", "getTodaySchedule"]);
  });

  // empty-vs-error: a tool that returned { error } is a FAILURE row, not a success row
  // and not a missing row.
  it("a tool that soft-failed is recorded as a failure, never as a success", () => {
    recordToolObservations({ steps: [step("getTodaySchedule", { error: "calendar offline" })] }, undefined);
    expect(recordToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "getTodaySchedule", success: false, errorMessage: "calendar offline" }),
    );
  });

  it("CONTROL · a generation that ran no tool records nothing", () => {
    expect(recordToolObservations({ steps: [] }, "c1")).toEqual([]);
    expect(recordToolObservations({}, "c1")).toEqual([]);
    expect(recordToolInvocation).not.toHaveBeenCalled();
  });
});

describe("walkToolTelemetry · who records what", () => {
  it("a streaming turn records each call once, through the same recorder", () => {
    const captured = walkToolTelemetry({ ev: { steps: [step("getTasks", { tasks: [] })] }, convId: "c1" });
    expect(recordToolInvocation).toHaveBeenCalledTimes(1);
    expect(captured.map((c) => c.name)).toEqual(["getTasks"]);
  });

  // The sampled lanes already recorded their samples when they ran. A lane turn reaches the
  // walk with names only, and the walk must neither invent a row from a bare name nor
  // double the samples.
  it("a lane turn (names, no steps) records nothing here and says so in tool.chosen", async () => {
    walkToolTelemetry({
      ev: { text: "hi" },
      convId: "c1",
      traceId: "t1",
      lane: "regen",
      laneToolNames: ["getTasks"],
      laneReceiptsAvailable: true,
    } as never);
    expect(recordToolInvocation).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    const chosen = recordMetricStrict.mock.calls.find((c) => c[0] === "tool.chosen");
    expect((chosen?.[2] as { tags: Record<string, unknown> }).tags).toMatchObject({ source: "lane", tools: ["getTasks"] });
  });
});
