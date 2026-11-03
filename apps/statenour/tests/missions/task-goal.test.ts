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
  goalFilterLabel,
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

describe("goalFilterOptions · boundaries and stale links (second reader, 2026-11-02)", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => goal(`g${i}`, `Goal ${i}`));
  const linked = (goals: GoalRow[]) => withTaskGoals(goals.map((g, i) => task(`t${i}`, "m1", g.id)), [mission("m1")], goals);

  it("CAP+3 goals, the selected one at index CAP+2: exactly CAP+1 ids, the selected last", () => {
    const goals = many(GOAL_FILTER_CHIP_CAP + 3);
    const sel = goals[GOAL_FILTER_CHIP_CAP + 2].id;
    const ids = goalFilterOptions(linked(goals), [mission("m1")], goals, sel).map((o) => o.id);
    expect(ids).toHaveLength(GOAL_FILTER_CHIP_CAP + 1);
    expect(ids[ids.length - 1]).toBe(sel);
  });

  it("exactly CAP goals, the selected one at CAP-1: CAP ids, no duplicate", () => {
    const goals = many(GOAL_FILTER_CHIP_CAP);
    const ids = goalFilterOptions(linked(goals), [mission("m1")], goals, goals[GOAL_FILTER_CHIP_CAP - 1].id).map((o) => o.id);
    expect(ids).toHaveLength(GOAL_FILTER_CHIP_CAP);
    expect(new Set(ids).size).toBe(GOAL_FILTER_CHIP_CAP);
  });

  it("a stale ?goalId= filters to nothing and adds no phantom chip", () => {
    const missions = [mission("m1", { id: "g-run", title: "Run" })];
    const tasks = withTaskGoals([task("a", "m1")], missions, GOALS);
    expect(filterByGoal(tasks, missions, "g-gone")).toEqual({ tasks: [], missions: [] });
    expect(goalFilterOptions(tasks, missions, GOALS, "g-gone").map((o) => o.id)).not.toContain("g-gone");
  });

  it("no chips until the goals list is known (an archived goal never flashes a chip)", () => {
    const missions = [mission("m1", { id: "g-old", title: "Old goal" })];
    expect(goalFilterOptions(withTaskGoals([task("a", "m1")], missions, undefined), missions, undefined)).toEqual([]);
  });
});

describe("goalFilterLabel · the active-filters pill says why a goal has no chip", () => {
  const missions = [mission("m1", { id: "g-run", title: "Run a half marathon" })];
  const tasks = withTaskGoals([task("a", "m1")], missions, GOALS);
  const opts = goalFilterOptions(tasks, missions, GOALS);

  it("a goal with a chip reads its title", () => {
    expect(goalFilterLabel("g-run", opts, GOALS)).toBe("goal · Run a half marathon");
  });
  it("an id the goals read does not hold as active reads archived or not found", () => {
    expect(goalFilterLabel("g-gone", opts, GOALS)).toBe("goal · archived or not found");
    expect(goalFilterLabel("g-old", opts, [...GOALS, goal("g-old", "Old", { status: "archived" })])).toBe("goal · archived or not found");
  });
  it("an active goal with no linked work reads no linked work", () => {
    expect(goalFilterLabel("g-cash", opts, GOALS)).toBe("goal · Save 10k · no linked work");
  });
  it("before the goals read lands it says the titles are not read", () => {
    expect(goalFilterLabel("g-run", [], undefined)).toBe("goal · title not read");
  });
});

describe("withTaskGoals · an untitled goal says why (loading, failed, absent)", () => {
  const mk = (goals: GoalRow[] | undefined, read: "ok" | "loading" | "failed") =>
    withTaskGoals([task("a", "m1", "g-cash")], [mission("m1")], goals, read)[0].goal;
  it("loading", () => expect(mk(undefined, "loading")).toEqual({ id: "g-cash", title: null, source: "task", missing: "loading" }));
  it("failed", () => expect(mk(undefined, "failed")).toEqual({ id: "g-cash", title: null, source: "task", missing: "failed" }));
  it("read answered but the goal is not in it", () => expect(mk([], "ok")).toEqual({ id: "g-cash", title: null, source: "task", missing: "absent" }));
  it("POSITIVE CONTROL: a titled goal carries no missing flag", () => expect(mk(GOALS, "ok")).toEqual({ id: "g-cash", title: "Save 10k", source: "task" }));
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
