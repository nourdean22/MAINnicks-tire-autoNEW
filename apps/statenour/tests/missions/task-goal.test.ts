/**
 * Goals on /missions (job 2026-11-02-nour-os-interconnect W3).
 *
 * A task belongs to a goal through its own `goalId` or, when that is empty,
 * through its mission's `lifeGoalId` (Linear L1: the link lives one level up and
 * flows down at read time; no backfill). One function decides it, `taskGoal`;
 * the board's chips, the goal filter and the hidden-risk pace bump all read it.
 */
import { describe, expect, it } from "vitest";

import {
  GOAL_FILTER_CHIP_CAP,
  filterByGoal,
  goalFilterHref,
  goalFilterOptions,
  goalLineage,
  riskTasks,
  taskGoal,
  withTaskGoals,
  type GoalRow,
} from "@/lib/missions/task-goal";
import { computeHiddenRiskSummary } from "@/lib/tasks/hidden-risk";
import type { Project, Task } from "@/components/actions/shared";

const NOW = Date.parse("2026-11-02T15:00:00.000Z");

const goal = (id: string, title: string, extra: Partial<GoalRow> = {}): GoalRow => ({
  id,
  title,
  status: "active",
  currentValue: 0,
  targetValue: 0,
  unit: "",
  deadline: null,
  horizon: null,
  createdAt: "2026-10-01T12:00:00.000Z",
  ...extra,
});

const GOALS: GoalRow[] = [goal("g-run", "Run a half marathon"), goal("g-cash", "Save 10k")];
const mission = (id: string, lifeGoal: { id: string; title: string } | null = null): Project =>
  ({ id, title: `Mission ${id}`, status: "ACTIVE", lifeGoal }) as Project;
const task = (id: string, missionId: string, goalId: string | null = null, status = "READY"): Task =>
  ({ id, title: `Task ${id}`, missionId, goalId, status }) as Task;

describe("taskGoal · own goal wins, then the mission's, else none", () => {
  const titles = new Map(GOALS.map((g) => [g.id, g.title]));

  it("a task's own goalId wins over its mission's goal", () => {
    const m = mission("m1", { id: "g-run", title: "Run a half marathon" });
    expect(taskGoal(task("t1", "m1", "g-cash"), m, titles)).toEqual({ id: "g-cash", title: "Save 10k", source: "task" });
  });

  it("a task with no goalId inherits its mission's goal", () => {
    const m = mission("m1", { id: "g-run", title: "Run a half marathon" });
    expect(taskGoal(task("t1", "m1"), m, titles)).toEqual({ id: "g-run", title: "Run a half marathon", source: "mission" });
  });

  it("no goal when both the task and the mission have none", () => {
    expect(taskGoal(task("t1", "m1"), mission("m1"), titles)).toBeNull();
    expect(taskGoal(task("t1", ""), undefined, titles)).toBeNull();
  });

  it("an own goal equal to the mission's reads as the mission's (the card already shows it)", () => {
    const m = mission("m1", { id: "g-run", title: "Run a half marathon" });
    expect(taskGoal(task("t1", "m1", "g-run"), m, titles)?.source).toBe("mission");
  });

  it("an unread goal title stays null, never a made-up label", () => {
    expect(taskGoal(task("t1", "m1", "g-cash"), mission("m1"), new Map())).toEqual({ id: "g-cash", title: null, source: "task" });
  });
});

describe("withTaskGoals · the board's read model", () => {
  it("carries the resolved goal on every task, titles from the goals read and the mission", () => {
    const missions = [mission("m1", { id: "g-run", title: "Run a half marathon" }), mission("m2")];
    const out = withTaskGoals([task("a", "m1"), task("b", "m2", "g-cash"), task("c", "m2")], missions, GOALS);
    expect(out.map((t) => t.goal)).toEqual([
      { id: "g-run", title: "Run a half marathon", source: "mission" },
      { id: "g-cash", title: "Save 10k", source: "task" },
      null,
    ]);
  });

  it("with the goals read missing, an inherited title still comes from the mission", () => {
    const out = withTaskGoals([task("a", "m1")], [mission("m1", { id: "g-run", title: "Run a half marathon" })], undefined);
    expect(out[0].goal?.title).toBe("Run a half marathon");
  });
});

describe("filterByGoal · both the task rows and the mission cards", () => {
  const missions = [mission("m1", { id: "g-run", title: "Run" }), mission("m2"), mission("m3")];
  const tasks = withTaskGoals([task("a", "m1"), task("b", "m2", "g-run"), task("c", "m2"), task("d", "m3")], missions, GOALS);

  it("keeps tasks whose own or inherited goal matches, and the missions that hold them", () => {
    const out = filterByGoal(tasks, missions, "g-run");
    expect(out.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(out.missions.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("no goal selected changes nothing", () => {
    const out = filterByGoal(tasks, missions, null);
    expect(out.tasks).toBe(tasks);
    expect(out.missions).toBe(missions);
  });

  it("a mission linked to the goal stays even with no task yet", () => {
    const out = filterByGoal([], [mission("m9", { id: "g-run", title: "Run" })], "g-run");
    expect(out.missions.map((m) => m.id)).toEqual(["m9"]);
  });
});

describe("goalFilterOptions · chips only for goals with linked work", () => {
  it("is EMPTY when nothing is linked (the row hides; it never says 'no goals')", () => {
    const missions = [mission("m1")];
    expect(goalFilterOptions(withTaskGoals([task("a", "m1")], missions, GOALS), missions, GOALS)).toEqual([]);
  });

  it("lists active goals with an open task or a live mission, most-linked first", () => {
    const missions = [mission("m1", { id: "g-run", title: "Run a half marathon" }), mission("m2")];
    const tasks = withTaskGoals([task("a", "m1"), task("b", "m2", "g-cash"), task("c", "m2", "g-cash"), task("d", "m2", "g-cash")], missions, GOALS);
    expect(goalFilterOptions(tasks, missions, GOALS)).toEqual([
      { id: "g-cash", title: "Save 10k" },
      { id: "g-run", title: "Run a half marathon" },
    ]);
  });

  it("a done task does not make a chip, an archived goal never does", () => {
    const goals = [goal("g-old", "Old goal", { status: "archived" }), ...GOALS];
    const missions = [mission("m1")];
    const tasks = withTaskGoals([task("a", "m1", "g-old"), task("b", "m1", "g-run", "DONE")], missions, goals);
    expect(goalFilterOptions(tasks, missions, goals)).toEqual([]);
  });

  it(`caps the row at ${GOAL_FILTER_CHIP_CAP} chips`, () => {
    const many = Array.from({ length: GOAL_FILTER_CHIP_CAP + 3 }, (_, i) => goal(`g${i}`, `Goal ${i}`));
    const missions = [mission("m1")];
    const tasks = withTaskGoals(many.map((g, i) => task(`t${i}`, "m1", g.id)), missions, many);
    expect(goalFilterOptions(tasks, missions, many)).toHaveLength(GOAL_FILTER_CHIP_CAP);
  });

  it("the selected goal keeps its chip even past the cap, so it can be cleared", () => {
    const many = Array.from({ length: GOAL_FILTER_CHIP_CAP + 3 }, (_, i) => goal(`g${i}`, `Goal ${i}`));
    const missions = [mission("m1")];
    const last = many[many.length - 1].id;
    const tasks = withTaskGoals(many.map((g, i) => task(`t${i}`, "m1", g.id)), missions, many);
    expect(goalFilterOptions(tasks, missions, many, last).map((o) => o.id)).toContain(last);
  });
});

describe("goalFilterHref · the deep link the goal card and the chips share", () => {
  it("encodes the id and clears with null", () => {
    expect(goalFilterHref("g 1/x")).toBe("/missions?goalId=g%201%2Fx");
    expect(goalFilterHref(null)).toBe("/missions");
  });
});

describe("hidden-risk wiring · a goal behind pace bumps a task's risk", () => {
  // 10 of 100 done with 31 of 61 days gone: behind.
  const behind = goal("g-run", "Run a half marathon", {
    currentValue: 10,
    targetValue: 100,
    deadline: "2026-12-02T05:00:00.000Z",
    createdAt: "2026-10-02T12:00:00.000Z",
  });

  function summary(goals: GoalRow[], tasks: Task[], missions: Project[]) {
    return computeHiddenRiskSummary({
      allTasks: riskTasks(withTaskGoals(tasks, missions, goals)),
      visibleTaskIds: new Set(),
      filtersActive: true,
      executionModeActive: false,
      now: new Date(NOW),
      missions,
      goalLineage: goalLineage(goals, NOW),
    });
  }

  it("goalLineage reads the pace the goal card shows", () => {
    expect(goalLineage([behind], NOW).get("g-run")?.paceKind).toBe("behind");
    expect(goalLineage([goal("g-x", "No target")], NOW).get("g-x")?.paceKind).toBe("unscored");
  });

  it("a hidden task under a mission whose goal is behind is flagged goal_behind", () => {
    const missions = [mission("m1", { id: "g-run", title: "Run a half marathon" })];
    const s = summary([behind], [{ ...task("a", "m1"), updatedAt: new Date(NOW).toISOString() } as Task], missions);
    expect(s.hiddenTasks.map((h) => h.risk.reason)).toEqual(["goal_behind"]);
  });

  it("POSITIVE CONTROL: the same task with an on-track goal is not flagged", () => {
    const onTrack = { ...behind, currentValue: 60 };
    const missions = [mission("m1", { id: "g-run", title: "Run a half marathon" })];
    const s = summary([onTrack], [{ ...task("a", "m1"), updatedAt: new Date(NOW).toISOString() } as Task], missions);
    expect(s.hiddenTasks).toEqual([]);
  });
});
