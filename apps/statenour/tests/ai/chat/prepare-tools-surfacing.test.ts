/**
 * 2026-08-25 · tool-surfacing telemetry canary.
 *
 * prepareTools now records the FINAL offered tool set (metric
 * `tool.surfaced`) so the usage census can split "never surfaced by the
 * pruner" from "surfaced and never chosen". This test asserts the
 * BEHAVIOR, not presence: the recorded set must reflect every stage —
 * pruner output, operator blocklist removal, recovery-lane force,
 * action-intent force, and the read-mode strip (WP-14, which runs LAST)
 * — i.e. exactly the object handed to the model. A read-mode turn whose
 * metric claimed a mutating tool was offered would reintroduce the
 * surfaced-vs-chosen confound on precisely the turns where the strip
 * matters. Delete the recordMetricStrict call and this file goes red.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { recordMetric, recordMetricStrict, markSearchToolsFired, markInvokeToolFired } = vi.hoisted(() => ({
  /** Kept so the mocked module still exports what other consumers import. */
  recordMetric: vi.fn().mockResolvedValue(undefined),
  // 2026-09-16 · the surfacing census now uses the PROPAGATING writer. The
  // fail-soft one could never reject, so its failure branch was dead code and
  // a dead census instrument looked exactly like "that tool was never
  // surfaced". The mock resolves a RECEIPT, matching the real signature.
  recordMetricStrict: vi.fn().mockResolvedValue({ id: "metric-row-1" }),
  markSearchToolsFired: vi.fn().mockResolvedValue(undefined),
  markInvokeToolFired: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/services/metrics", () => ({ recordMetric, recordMetricStrict }));
vi.mock("@/lib/ai/tool-selection-telemetry", () => ({
  markSearchToolsFired,
  markInvokeToolFired,
}));

// The pruner returns a subset; the mock ignores inputs — stage behavior
// downstream of it is what this file pins.
vi.mock("@/lib/ai/chat-mode", () => ({
  pruneTools: vi.fn(async (_mode: string, _tools: Record<string, unknown>) => ({
    toolA: { description: "a" },
    toolB: { description: "b" },
  })),
  describeMode: vi.fn(() => "mocked"),
}));

vi.mock("@/lib/ai/tools", () => ({
  nourTools: {
    toolA: { description: "a" },
    toolB: { description: "b" },
    toolC: { description: "c" },
    searchTools: {
      description: "recovery search",
      execute: vi.fn().mockResolvedValue({ tools: [] }),
    },
    invokeTool: {
      description: "recovery invoke",
      execute: vi.fn().mockResolvedValue({ result: "ok" }),
    },
  },
}));

// WP-14 read-mode strip — dynamically imported by prepareTools only when
// actionPermission === "read". The mock strips toolA and reports it, the
// same contract as the real capability-registry implementation.
vi.mock("@/lib/ai/capability-registry", () => ({
  stripMutatingTools: (tools: Record<string, unknown>) => {
    const { toolA: _stripped, ...rest } = tools;
    return { tools: rest, stripped: "toolA" in tools ? ["toolA"] : [] };
  },
}));

import { prepareTools } from "@/app/api/ai/chat/prepare-tools";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

function args(overrides: Partial<Parameters<typeof prepareTools>[0]> = {}) {
  return {
    mode: "standard" as never,
    messages: [],
    userContent: "hello",
    userEmbedding: [],
    aiConfig: null,
    actionIntent: null,
    webSearchIntent: false,
    queryShape: { shape: "default", tokenBudget: 0, needsTool: false, factualHints: [] } as never,
    finalSystemPromptLength: 100,
    log,
    ...overrides,
  };
}

describe("prepareTools surfacing telemetry", () => {
  beforeEach(() => {
    recordMetricStrict.mockClear();
    markSearchToolsFired.mockClear();
    markInvokeToolFired.mockClear();
  });

  it("records the FINAL offered set plus registered/discoverable/surfaced truth", async () => {
    const result = await prepareTools(args({ traceId: "trace-cap" }));
    await vi.waitFor(() => expect(recordMetricStrict).toHaveBeenCalledTimes(1));
    const [metric, value, opts] = recordMetricStrict.mock.calls[0];
    expect(metric).toBe("tool.surfaced");
    // searchTools + invokeTool are force-added by the recovery lane, so the
    // recorded set proves the metric fires AFTER the forces, not on the raw
    // pruner output.
    expect(opts.tags.tools).toEqual(["invokeTool", "searchTools", "toolA", "toolB"]);
    expect(value).toBe(4);
    expect(opts.tags.mode).toBe("standard");
    expect(opts.tags.traceId).toBe("trace-cap");
    expect(opts.source).toBe("chat");

    expect(result.capabilityPlan.registered).toEqual([
      "invokeTool",
      "searchTools",
      "toolA",
      "toolB",
      "toolC",
    ]);
    expect(result.capabilityPlan.discoverableCount).toBe(5);
    expect(result.capabilityPlan.surfaced).toEqual([
      "invokeTool",
      "searchTools",
      "toolA",
      "toolB",
    ]);
    expect(opts.tags.capabilityPlan).toEqual(result.capabilityPlan);
  });

  it("reflects blocklist removals and action-intent forces in the recorded set", async () => {
    const result = await prepareTools(
      args({
        aiConfig: { disabledTools: ["toolB"], alwaysOnTools: [] } as never,
        actionIntent: { intent: "create task", expectedTool: "toolC" } as never,
      }),
    );
    await vi.waitFor(() => expect(recordMetricStrict).toHaveBeenCalledTimes(1));
    const [, , opts] = recordMetricStrict.mock.calls[0];
    // toolB deleted by the operator blocklist; toolC force-added by the
    // action-intent coherence guarantee.
    expect(opts.tags.tools).toEqual(["invokeTool", "searchTools", "toolA", "toolC"]);
    expect(result.capabilityPlan.disabled).toEqual(["toolB"]);
    expect(result.capabilityPlan.discoverable).not.toContain("toolB");
    expect(result.capabilityPlan.forced.toolC).toBe("action intent: create task");
  });

  it("records policy provenance even when the pruner already surfaced the guaranteed tool", async () => {
    const result = await prepareTools(
      args({ aiConfig: { disabledTools: [], alwaysOnTools: ["toolA"] } as never }),
    );
    expect(result.capabilityPlan.surfaced).toContain("toolA");
    // This is the mutation canary for a subtle provenance bug: force reasons
    // describe WHY availability was guaranteed, not merely whether assignment
    // happened in the force branch.
    expect(result.capabilityPlan.forced.toolA).toBe("operator alwaysOnTools");
    expect(result.capabilityPlan.forced.searchTools).toBe("read-safe capability recovery lane");
  });

  it("records the set AFTER the WP-14 read-mode strip — a stripped mutator must not appear offered", async () => {
    const result = await prepareTools(args({ actionPermission: "read" }));
    await vi.waitFor(() => expect(recordMetricStrict).toHaveBeenCalledTimes(1));
    const [, value, opts] = recordMetricStrict.mock.calls[0];
    // toolA was stripped by read mode; recording it as offered would
    // falsely blame the model for never choosing a tool it never saw.
    expect(opts.tags.tools).toEqual(["invokeTool", "searchTools", "toolB"]);
    expect(value).toBe(3);
    expect(result.capabilityPlan.surfaced).not.toContain("toolA");
    expect(result.capabilityPlan.forced).not.toHaveProperty("toolA");
  });

  it("never lets a telemetry failure break tool preparation", async () => {
    recordMetric.mockRejectedValueOnce(new Error("db down"));
    const result = await prepareTools(args());
    expect(Object.keys(result.prunedTools).sort()).toEqual([
      "invokeTool",
      "searchTools",
      "toolA",
      "toolB",
    ]);
    // Flush the fire-and-forget chain so an unhandled rejection would surface
    // in THIS test rather than poisoning a neighbor.
    await new Promise((r) => setTimeout(r, 0));
  });

  it("marks the recovery tools only when this traced turn actually executes them", async () => {
    const result = await prepareTools(args({ traceId: "trace-1" }));
    const recoveryTools = result.prunedTools as unknown as Record<string, {
      execute: (input: Record<string, unknown>) => Promise<unknown>;
    }>;

    await recoveryTools.searchTools.execute({ query: "sleep data" });
    await recoveryTools.invokeTool.execute({ name: "getHabitStreaks" });

    expect(markSearchToolsFired).toHaveBeenCalledWith("trace-1", "sleep data");
    expect(markInvokeToolFired).toHaveBeenCalledWith("trace-1", "getHabitStreaks");
  });
  it("offers zero tools and ignores query-shape clamps in research compiler mode", async () => {
    const result = await prepareTools(
      args({
        researchCompilerMode: "general",
        webSearchIntent: true,
        actionIntent: { intent: "create task", expectedTool: "toolC" } as never,
        queryShape: { shape: "yesno", tokenBudget: 80, needsTool: true, factualHints: ["web"] } as never,
        traceId: "trace-drq",
      }),
    );
    await vi.waitFor(() => expect(recordMetricStrict).toHaveBeenCalledTimes(1));
    const [, value, opts] = recordMetricStrict.mock.calls[0];
    expect(Object.keys(result.prunedTools)).toEqual([]);
    expect(result.maxOutputTokens).toBe(8000);
    expect(value).toBe(0);
    expect(opts.tags.tools).toEqual([]);
    expect(result.capabilityPlan.surfacedCount).toBe(0);
  });

});
