/**
 * Canaries for the tool_telemetry undercount on lane-sourced turns.
 *
 * WHY THIS FILE EXISTS. tool_telemetry showed 4 tools with a call in 14 days
 * while system_metrics `tool.chosen` showed 17 distinct tools chosen
 * (census 2026-10-23). The regen and self-consistency lanes in
 * `alternate-paths.ts` hand the persist walk NO `ev.steps`, only the names of
 * the winning generation, so the walk wrote `tool.chosen` but never called
 * `recordToolInvocation`. A tool called on those turns left no
 * `tool_telemetry` row, and the three readers of that table (/system/tools,
 * the circuit breaker, the tool-description-rewrite cron) saw a smaller world
 * than the one that ran.
 *
 * The fix keeps ONE recorder: the lane hands the winning generation's own
 * steps to the walk, and the walk records them through the same loop it uses
 * for the streaming path, with real success and duration. It never invents an
 * outcome from a bare name.
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

import { walkToolTelemetry } from "@/lib/services/chat/tool-telemetry-walk";
import { attributeWinningSample } from "@/lib/services/chat/lane-sample-attribution";

/** One finished SDK step: a call and its returned value. */
function step(toolName: string, output: unknown, id = `tc-${toolName}`) {
  return {
    toolCalls: [{ toolName, toolCallId: id, input: {} }],
    toolResults: [{ toolName, toolCallId: id, output }],
  };
}

/** A lane turn: no ev.steps, the winning generation's steps ride beside it. */
function laneTurn(steps: unknown[], names: string[]) {
  return {
    ev: { text: "hi", finishReason: "stop" },
    convId: "c-lane",
    traceId: "t-lane",
    lane: "self-consistency",
    laneToolNames: names,
    laneReceiptsAvailable: true,
    laneTelemetrySteps: steps,
  } as never;
}

beforeEach(() => {
  recordToolInvocation.mockClear();
  recordMetricStrict.mockClear();
});

describe("walkToolTelemetry · lane-sourced turns", () => {
  it("records each tool the winning generation called, with its real outcome", () => {
    walkToolTelemetry(
      laneTurn([step("getCommitments", { items: [] }), step("getTodaySchedule", { events: [] })], [
        "getCommitments",
        "getTodaySchedule",
      ]),
    );
    const names = recordToolInvocation.mock.calls.map((c) => c[0].toolName).sort();
    expect(names).toEqual(["getCommitments", "getTodaySchedule"]);
    expect(recordToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "getCommitments", success: true, conversationId: "c-lane" }),
    );
  });

  // empty-vs-error: a lane tool that returned { error } is a FAILURE row, not
  // a success row and not a missing row.
  it("a lane tool that soft-failed is recorded as a failure, never as a success", () => {
    walkToolTelemetry(laneTurn([step("getTodaySchedule", { error: "calendar offline" })], ["getTodaySchedule"]));
    expect(recordToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "getTodaySchedule",
        success: false,
        errorMessage: "calendar offline",
      }),
    );
  });

  // The claim verifier and the evidence gate read the walk's return value.
  // Recording telemetry for a lane must not change what they see.
  it("does not feed lane calls into the captured-call buffer the verifiers read", () => {
    const captured = walkToolTelemetry(laneTurn([step("getCommitments", {})], ["getCommitments"]));
    expect(captured).toEqual([]);
  });

  // Never invent an outcome. Names alone carry no success or duration.
  it("a lane that supplied names but no steps records nothing and says so in tool.chosen", async () => {
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
    expect((chosen?.[2] as { tags: Record<string, unknown> }).tags.source).toBe("lane");
  });

  // POSITIVE CONTROL for the streaming path: the same step recorded once, and
  // lane steps never double it when ev.steps is present.
  it("streaming turns still record once, and ev.steps wins over lane steps", () => {
    walkToolTelemetry({
      ev: { steps: [step("getTasks", { tasks: [] })] },
      convId: "c1",
      laneTelemetrySteps: [step("getTasks", { tasks: [] })],
    } as never);
    expect(recordToolInvocation).toHaveBeenCalledTimes(1);
  });
});

describe("attributeWinningSample · carries the winner's steps", () => {
  const winnerSteps = [step("getCommitments", {})];
  const samples = [
    { text: "a", calls: ["searchMemories"], steps: [step("searchMemories", {})] },
    { text: "b", calls: ["getCommitments"], steps: winnerSteps },
  ];

  it("returns the steps of the generation that won, not the losers", () => {
    const a = attributeWinningSample({ samples, winningText: "b", alreadyAvailable: false });
    expect(a?.steps).toBe(winnerSteps);
  });

  it("stays blind (null) when the winner is ambiguous, so no steps are guessed", () => {
    const tie = [
      { text: "same", calls: ["getTasks"], steps: [step("getTasks", {})] },
      { text: "same", calls: ["getCommitments"], steps: [step("getCommitments", {})] },
    ];
    expect(attributeWinningSample({ samples: tie, winningText: "same", alreadyAvailable: false })).toBeNull();
  });
});
