/**
 * W8a items 2 (read side) and 3 (audit A2/C2, A5/C1): every goal count reads through goalTaskWhere, and the goal
 * shows ONE number everywhere. $15k target, $12k value, 1 of 3 tasks done -> 80 on the card, in Nick's prompt
 * and on the goals page grounding; a milestone goal with the same tasks -> 33.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lifeGoal: { findMany: vi.fn() },
  goalEvent: { findMany: vi.fn() },
  task: { findMany: vi.fn() },
  masteryScore: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: { lifeGoal: h.lifeGoal, goalEvent: h.goalEvent, task: h.task, masteryScore: h.masteryScore } }));
vi.mock("@/lib/nickstire/revenue", () => ({ readNickRevenue: vi.fn(() => ({ hasToday: false })) }));

import { activeGoalsWithHealth, goalProgress } from "@/lib/services/goal-health";
import { goalSummaryFromHealth } from "@/lib/ai/context/command-center-state";
import { goalTaskWhere } from "@/lib/services/task-goal-server";

const NOW = Date.parse("2026-11-20T17:00:00.000Z");
const metricGoal = {
  id: "g1", title: "Revenue", kind: "metric", horizon: "MONTH", unit: "$", currentValue: 12000, targetValue: 15000, domain: "BUSINESS", metric: "revenue",
  status: "active", deadline: null, createdAt: new Date("2026-11-01T05:00:00.000Z"),
};
// 1 of 3 tasks done; two of them have no goal of their own and count through their mission's lifeGoalId.
const tasks = [
  { goalId: "g1", status: "DONE", mission: { lifeGoalId: null } },
  { goalId: null, status: "READY", mission: { lifeGoalId: "g1" } },
  { goalId: null, status: "DOING", mission: { lifeGoalId: "g1" } },
];

beforeEach(() => {
  h.lifeGoal.findMany.mockReset().mockResolvedValue([metricGoal]);
  h.goalEvent.findMany.mockReset().mockResolvedValue([]);
  h.task.findMany.mockReset().mockResolvedValue(tasks);
  h.masteryScore.findMany.mockReset().mockResolvedValue([]);
});

describe("goalProgress · the one rule", () => {
  it("a metric goal with a target is its value %, whatever its tasks say", () => {
    expect(goalProgress({ kind: "metric", targetValue: 15000, currentValue: 12000, done: 1, total: 3 })).toBe(80);
  });
  it("every other goal is its task %", () => {
    expect(goalProgress({ kind: "milestone", targetValue: 15000, currentValue: 12000, done: 1, total: 3 })).toBe(33);
    expect(goalProgress({ kind: "metric", targetValue: 0, currentValue: 5, done: 2, total: 4 })).toBe(50);
  });
  it("no tasks and no metric target is 0, never the stored column; a value past the target caps at 100", () => {
    expect(goalProgress({ kind: "narrative", targetValue: 0, currentValue: 0, done: 0, total: 0 })).toBe(0);
    expect(goalProgress({ kind: "metric", targetValue: 10, currentValue: 25, done: 0, total: 0 })).toBe(100);
  });
});

describe("activeGoalsWithHealth · counts through goalTaskWhere and carries the one number", () => {
  it("reads the goals' tasks with the shared filter and counts an inherited task as open", async () => {
    const { goals, failed } = await activeGoalsWithHealth(NOW);
    expect(failed).toEqual([]);
    expect(h.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ deletedAt: null, ...goalTaskWhere(["g1"]) }) }));
    expect(goals[0]).toMatchObject({ id: "g1", openTasks: 2, progress: 80, tasksDone: 1, tasksTotal: 3 });
  });
  it("a milestone goal with the same tasks is 33", async () => {
    h.lifeGoal.findMany.mockResolvedValue([{ ...metricGoal, kind: "milestone" }]);
    const { goals } = await activeGoalsWithHealth(NOW);
    expect(goals[0].progress).toBe(33);
  });
  it("a failed tasks read is named, and the counts are null, not zero", async () => {
    h.task.findMany.mockRejectedValue(new Error("db down"));
    const { goals, failed } = await activeGoalsWithHealth(NOW);
    expect(failed).toContain("tasks");
    expect(goals[0].openTasks).toBeNull();
    expect(goals[0].progress).toBe(80); // a metric goal's number needs no tasks
    expect({ ...goals[0], kind: "milestone" }.progress).toBe(80);
  });
  it("a metric goal's number survives a failed tasks read; a task goal's does not", async () => {
    h.task.findMany.mockRejectedValue(new Error("db down"));
    h.lifeGoal.findMany.mockResolvedValue([{ ...metricGoal, kind: "milestone" }]);
    const { goals } = await activeGoalsWithHealth(NOW);
    expect(goals[0].progress).toBeNull();
  });
});

describe("Nick's prompt reads the same number", () => {
  it("goalSummaryFromHealth carries the computed progress, the pace line and the open count", async () => {
    const { goals } = await activeGoalsWithHealth(NOW);
    const s = goalSummaryFromHealth(goals[0]);
    expect(s).toMatchObject({ id: "g1", title: "Revenue", domain: "BUSINESS", metric: "revenue", progress: 80, openTasks: 2, horizon: "MONTH", daysToDeadline: null });
    expect(typeof s.paceLine === "string" || s.paceLine === null).toBe(true);
  });
  it("the goals page grounding line shows the computed number", async () => {
    const { buildPageData } = await import("@/lib/ai/page-data");
    const text = await buildPageData("goals");
    expect(text).toContain("[id:g1] 80%");
  });
});
