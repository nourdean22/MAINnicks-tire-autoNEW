/**
 * Nick's "Active Goals" block (job 2026-10-30-goals-system W3). Each goal line carries the
 * same date/pace label the goal card shows (a derived date says "(from horizon)") and says
 * "no next step" when the goal has no open linked task, so Nick can propose one. One line
 * per goal in the existing block, no new section. An unknown task count claims nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { toGoalSummary } from "@/lib/ai/context/command-center-state";
import { renderWhyBlock } from "@/lib/ai/prompt/v2/renderer";
import type { NickPrimeContext } from "@/lib/ai/context/nick-prime-context";

const NOW = Date.parse("2026-10-30T15:30:00.000Z"); // Fri 11:30 ET
const row = {
  id: "g1",
  title: "Week goal",
  domain: "business",
  metric: "",
  targetValue: 0,
  currentValue: 0,
  unit: "",
  progress: 0,
  horizon: "WEEK",
  deadline: null,
  createdAt: new Date("2026-10-28T16:00:00.000Z"),
};

describe("toGoalSummary · the card's label and the next-step count", () => {
  it("carries the derived date label and the open task count", () => {
    const s = toGoalSummary({ ...row, _count: { tasks: 0 }, events: [] }, { now: NOW });
    expect(s.paceLine).toBe("2d left · end of week (from horizon) · no target set");
    expect(s.openTasks).toBe(0);
  });

  it("counts the period from the latest horizon_set", () => {
    const s = toGoalSummary(
      { ...row, createdAt: new Date("2026-09-20T15:00:00.000Z"), _count: { tasks: 1 }, events: [{ createdAt: new Date("2026-10-30T15:00:00.000Z") }] },
      { now: NOW },
    );
    expect(s.paceLine).toBe("2d left · end of week (from horizon) · no target set");
    expect(s.openTasks).toBe(1);
  });

  afterEach(() => vi.useRealTimers());

  it("is safe inside Array.map: the index is never read as the clock (W3 review P0)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const out = [row, row].map((g) => ({ ...g, _count: { tasks: 0 }, events: [] })).map(toGoalSummary);
    expect(out.map((s) => s.paceLine)).toEqual([
      "2d left · end of week (from horizon) · no target set",
      "2d left · end of week (from horizon) · no target set",
    ]);
  });
});

describe("Active Goals block · 'no next step' is one flag on the goal's own line", () => {
  const ctx = (goal: Partial<NickPrimeContext["activeGoals"][number]>): NickPrimeContext =>
    ({
      activeMissions: [],
      activeGoals: [
        {
          id: "g1",
          title: "Week goal",
          domain: "business",
          metric: "",
          targetValue: 0,
          currentValue: 0,
          unit: "",
          progress: 0,
          horizon: "WEEK",
          daysToDeadline: null,
          ...goal,
        },
      ],
    }) as unknown as NickPrimeContext;
  const goalLine = (c: NickPrimeContext) =>
    renderWhyBlock(c).split("\n").find((l) => l.includes("Week goal")) ?? "";

  it("flags a goal with no open linked task and shows the card's label", () => {
    const line = goalLine(ctx({ openTasks: 0, paceLine: "2d left · end of week (from horizon) · no target set" }));
    expect(line).toContain("2d left · end of week (from horizon) · no target set");
    expect(line).toContain("no next step");
  });

  it("no flag when the goal has an open task", () => {
    expect(goalLine(ctx({ openTasks: 2 }))).not.toContain("no next step");
  });

  it("an unknown task count claims nothing", () => {
    expect(goalLine(ctx({ openTasks: null }))).not.toContain("no next step");
  });

  it("adds no new section heading", () => {
    const block = renderWhyBlock(ctx({ openTasks: 0 }));
    expect(block.match(/^## /gm)).toEqual(["## "]);
  });
});
