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
 * matters. Delete the recordMetric call and this file goes red.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const recordMetric = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/services/metrics", () => ({ recordMetric }));

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
    searchTools: { description: "recovery search" },
    invokeTool: { description: "recovery invoke" },
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
    recordMetric.mockClear();
  });

  it("records the FINAL offered set — pruner output plus the recovery lane, sorted", async () => {
    await prepareTools(args());
    await vi.waitFor(() => expect(recordMetric).toHaveBeenCalledTimes(1));
    const [metric, value, opts] = recordMetric.mock.calls[0];
    expect(metric).toBe("tool.surfaced");
    // searchTools + invokeTool are force-added by the recovery lane, so the
    // recorded set proves the metric fires AFTER the forces, not on the raw
    // pruner output.
    expect(opts.tags.tools).toEqual(["invokeTool", "searchTools", "toolA", "toolB"]);
    expect(value).toBe(4);
    expect(opts.tags.mode).toBe("standard");
    expect(opts.source).toBe("chat");
  });

  it("reflects blocklist removals and action-intent forces in the recorded set", async () => {
    await prepareTools(
      args({
        aiConfig: { disabledTools: ["toolB"], alwaysOnTools: [] } as never,
        actionIntent: { expectedTool: "toolC" } as never,
      }),
    );
    await vi.waitFor(() => expect(recordMetric).toHaveBeenCalledTimes(1));
    const [, , opts] = recordMetric.mock.calls[0];
    // toolB deleted by the operator blocklist; toolC force-added by the
    // action-intent coherence guarantee.
    expect(opts.tags.tools).toEqual(["invokeTool", "searchTools", "toolA", "toolC"]);
  });

  it("records the set AFTER the WP-14 read-mode strip — a stripped mutator must not appear offered", async () => {
    await prepareTools(args({ actionPermission: "read" }));
    await vi.waitFor(() => expect(recordMetric).toHaveBeenCalledTimes(1));
    const [, value, opts] = recordMetric.mock.calls[0];
    // toolA was stripped by read mode; recording it as offered would
    // falsely blame the model for never choosing a tool it never saw.
    expect(opts.tags.tools).toEqual(["invokeTool", "searchTools", "toolB"]);
    expect(value).toBe(3);
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
});
