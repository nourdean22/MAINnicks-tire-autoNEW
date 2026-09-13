import { describe, expect, it } from "vitest";
import { buildCapabilityPlan } from "@/lib/ai/chat/turn-control-plane";

describe("buildCapabilityPlan", () => {
  it("keeps registered, selected, forced, stripped and surfaced states distinct", () => {
    const plan = buildCapabilityPlan({
      traceId: "t_test",
      mode: "standard",
      registered: ["createTask", "searchTools", "invokeTool", "webSearch"],
      initiallySelected: ["searchTools"],
      surfaced: ["searchTools", "invokeTool", "webSearch"],
      disabled: ["createTask"],
      alwaysOn: ["searchTools"],
      forced: { web_search: ["webSearch"], recovery: ["invokeTool", "searchTools"] },
      stripped: [],
      semanticReady: true,
    });

    expect(plan.traceId).toBe("t_test");
    expect(plan.counts).toEqual({
      registered: 4,
      initiallySelected: 1,
      surfaced: 3,
      disabled: 1,
      stripped: 0,
    });
    expect(plan.disabled).toEqual(["createTask"]);
    expect(plan.forced.web_search).toEqual(["webSearch"]);
    expect(plan.recoveryLaneAvailable).toBe(true);
  });

  it("proves the recovery lane is unavailable when either half is missing", () => {
    const plan = buildCapabilityPlan({
      mode: "standard",
      registered: ["searchTools", "invokeTool"],
      initiallySelected: [],
      surfaced: ["searchTools"],
      semanticReady: false,
    });

    expect(plan.recoveryLaneAvailable).toBe(false);
  });

  it("deduplicates and sorts names so telemetry is stable", () => {
    const plan = buildCapabilityPlan({
      mode: "deep",
      registered: ["z", "a", "a"],
      initiallySelected: ["z", "z"],
      surfaced: ["z", "a", "z"],
      forced: { explicit: ["z", "a", "a"] },
      semanticReady: false,
    });

    expect(plan.registered).toEqual(["a", "z"]);
    expect(plan.initiallySelected).toEqual(["z"]);
    expect(plan.surfaced).toEqual(["a", "z"]);
    expect(plan.forced.explicit).toEqual(["a", "z"]);
  });
});
