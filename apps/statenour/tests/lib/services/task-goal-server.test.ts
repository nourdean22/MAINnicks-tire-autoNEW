/**
 * The ONE server-side task-goal rule (job 2026-11-02-nour-os-interconnect W8a, audit A2/C2/C12):
 * `goalTaskWhere` is the filter every goal count reads through (card, Nick's prompt, lift, spine),
 * `taskGoalServer` the resolver every "which goal is this task for" read uses (journal day, weekly
 * review, Home lead, spine). Four copies disagreed on a deleted own goal; this pins one answer.
 */
import { describe, expect, it } from "vitest";

import { TASK_GOAL_SELECT, goalTaskWhere, taskGoalServer } from "@/lib/services/task-goal-server";

const live = (id: string, title = `goal ${id}`) => ({ id, title, deletedAt: null });
const gone = (id: string) => ({ id, title: `goal ${id}`, deletedAt: new Date("2026-11-01T00:00:00Z") });

describe("goalTaskWhere", () => {
  it("matches a task by its own goalId OR, when it has none, by its mission's goal (Linear L1)", () => {
    expect(goalTaskWhere(["g1", "g2"])).toEqual({
      OR: [{ goalId: { in: ["g1", "g2"] } }, { goalId: null, mission: { lifeGoalId: { in: ["g1", "g2"] } } }],
    });
  });

  it("keys on ids only: no title ever enters the filter (guard rule)", () => {
    const where = JSON.stringify(goalTaskWhere(["Ship the brake job goal"]));
    expect(where).not.toMatch(/title/i);
  });

  it("copies the ids so a caller's later push does not widen the filter", () => {
    const ids = ["g1"];
    const where = goalTaskWhere(ids);
    ids.push("g2");
    expect(where.OR[0].goalId.in).toEqual(["g1"]);
  });
});

describe("taskGoalServer", () => {
  it("the task's own live goal wins over its mission's", () => {
    expect(taskGoalServer({ goal: live("own"), mission: { lifeGoal: live("mission") } })).toEqual({ id: "own", title: "goal own", source: "task" });
  });

  it("falls back to the mission's live goal when the task has none", () => {
    expect(taskGoalServer({ goal: null, mission: { lifeGoal: live("mission") } })).toEqual({ id: "mission", title: "goal mission", source: "mission" });
  });

  it("an archived own goal is not a goal: the mission's live goal is the answer", () => {
    expect(taskGoalServer({ goal: gone("own"), mission: { lifeGoal: live("mission") } })).toEqual({ id: "mission", title: "goal mission", source: "mission" });
  });

  it("null when neither is live, and when the task has no mission", () => {
    expect(taskGoalServer({ goal: gone("own"), mission: { lifeGoal: gone("mission") } })).toBeNull();
    expect(taskGoalServer({ goal: null, mission: null })).toBeNull();
    expect(taskGoalServer({})).toBeNull();
  });

  it("never reads a goal title out of the task (guard rule: a title is not a key)", () => {
    expect(taskGoalServer({ title: "goal g1", goal: null, mission: null } as never)).toBeNull();
  });

  it("TASK_GOAL_SELECT selects exactly what the resolver reads", () => {
    expect(TASK_GOAL_SELECT).toEqual({
      goal: { select: { id: true, title: true, deletedAt: true } },
      mission: { select: { lifeGoal: { select: { id: true, title: true, deletedAt: true } } } },
    });
  });
});
