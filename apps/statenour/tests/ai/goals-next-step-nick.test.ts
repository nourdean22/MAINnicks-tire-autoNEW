/**
 * Nick's "Active Goals" block (job 2026-10-30-goals-system W3; W8a 2026-11-03 routes it through the one goals
 * read, lib/services/goal-health.ts). Each goal line carries the same date/pace label the goal card shows (a
 * derived date says "(from horizon)"), the one computed progress number, and says "no next step" when the goal
 * has no open linked task, so Nick can propose one. An unknown task count or progress claims nothing.
 */
import { describe, expect, it } from "vitest";

import { goalSummaryFromHealth } from "@/lib/ai/context/command-center-state";
import type { ActiveGoalHealth } from "@/lib/services/goal-health";
import { renderWhyBlock } from "@/lib/ai/prompt/v2/renderer";
import type { NickPrimeContext } from "@/lib/ai/context/nick-prime-context";

const health: ActiveGoalHealth = {
  id: "g1",
  title: "Week goal",
  kind: "milestone",
  domain: "business",
  metric: "",
  horizon: "WEEK",
  unit: "",
  currentValue: 0,
  targetValue: 0,
  status: "active",
  deadline: null,
  createdAt: "2026-10-28T16:00:00.000Z",
  due: { at: "2026-11-01T03:59:59.999Z", source: "horizon" } as ActiveGoalHealth["due"],
  pace: "2d left · end of week (from horizon) · no target set",
  paceKind: null,
  health: { state: "no_check_in", at: null },
  openTasks: 0,
  tasksDone: 0,
  tasksTotal: 0,
  progress: 0,
};

describe("goalSummaryFromHealth · the card's label, number and next-step count, from the one read", () => {
  it("carries the pace label, the open task count and the computed progress", () => {
    const s = goalSummaryFromHealth(health);
    expect(s.paceLine).toBe("2d left · end of week (from horizon) · no target set");
    expect(s.openTasks).toBe(0);
    expect(s.progress).toBe(0);
  });

  it("passes an unread count and progress through as null, never zero", () => {
    const s = goalSummaryFromHealth({ ...health, openTasks: null, progress: null });
    expect(s.openTasks).toBeNull();
    expect(s.progress).toBeNull();
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
  const goalLine = (c: NickPrimeContext) => renderWhyBlock(c).split("\n").find((l) => l.includes("Week goal")) ?? "";

  it("says no next step with the pace label on the same line", () => {
    const line = goalLine(ctx({ openTasks: 0, paceLine: "2d left · end of week (from horizon) · no target set" }));
    expect(line).toContain("2d left · end of week (from horizon) · no target set");
    expect(line).toContain("no next step");
    expect(line).toContain("[id:g1]");
  });

  it("stays quiet when a task is open, and when the count is unknown", () => {
    expect(goalLine(ctx({ openTasks: 2 }))).not.toContain("no next step");
    expect(goalLine(ctx({ openTasks: null }))).not.toContain("no next step");
  });

  it("an unread progress is said, never rendered as 0%", () => {
    expect(goalLine(ctx({ progress: null }))).toContain("progress unread");
    expect(goalLine(ctx({ progress: null }))).not.toContain("0%");
  });

  it("the block has no second goals section", () => {
    const block = renderWhyBlock(ctx({ openTasks: 0 }));
    expect(block.match(/## Active Goals/g)?.length).toBe(1);
  });
});
