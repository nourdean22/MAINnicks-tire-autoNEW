/**
 * Which goal a task on /missions serves (job 2026-11-02-nour-os-interconnect W3).
 *
 * Linear L1: the goal link lives one level up, on the mission (`Mission.lifeGoalId`),
 * and flows down at READ time; a task's own `goalId` is the override. No backfill,
 * no second place to store the link. `taskGoal` is the one rule; the board's chips,
 * the goal filter and the hidden-risk pace bump all read it.
 */
import type { GoalLineageEntry, Project, Task } from "@/components/actions/shared";
import { goalPaceView } from "@/lib/brain/goal-pace";

/** The fields of a `task.goals` row this module reads. */
export type GoalRow = {
  id: string;
  title: string;
  status: string;
  currentValue: number;
  targetValue: number;
  unit: string;
  deadline: string | Date | null;
  horizon: string | null;
  createdAt: string | Date;
};

/** `source: "mission"` means the mission card already shows it. A null title was not read. */
export type TaskGoal = { id: string; title: string | null; source: "task" | "mission" };
export type GoalTask<T extends Task = Task> = T & { goal: TaskGoal | null };

/** CONTROLS RULE: the filter row's chip cap, named once. */
export const GOAL_FILTER_CHIP_CAP = 6;

export function taskGoal(
  task: Pick<Task, "goalId">,
  mission: Pick<Project, "lifeGoal"> | undefined,
  titles: ReadonlyMap<string, string>,
): TaskGoal | null {
  const missionGoal = mission?.lifeGoal ?? null;
  const own = task.goalId || null;
  if (own && own !== missionGoal?.id) return { id: own, title: titles.get(own) ?? null, source: "task" };
  if (missionGoal) return { id: missionGoal.id, title: titles.get(missionGoal.id) ?? missionGoal.title, source: "mission" };
  return null;
}

export function withTaskGoals<T extends Task>(tasks: T[], missions: Project[], goals: GoalRow[] | undefined): GoalTask<T>[] {
  const titles = new Map((goals ?? []).map((g) => [g.id, g.title]));
  const byId = new Map(missions.map((m) => [m.id, m]));
  return tasks.map((t) => ({ ...t, goal: taskGoal(t, byId.get(t.missionId), titles) }));
}

export function filterByGoal<T extends GoalTask, M extends Project>(
  tasks: T[],
  missions: M[],
  goalId: string | null,
): { tasks: T[]; missions: M[] } {
  if (!goalId) return { tasks, missions };
  const kept = tasks.filter((t) => t.goal?.id === goalId);
  const missionIds = new Set(kept.map((t) => t.missionId));
  return { tasks: kept, missions: missions.filter((m) => m.lifeGoal?.id === goalId || missionIds.has(m.id)) };
}

const OPEN = (status: string) => status !== "DONE" && status !== "ARCHIVED";

/**
 * Chips for goals that have an open task or a live mission on the board, most-linked first.
 * Empty when nothing is linked: the row hides. An archived goal (when the goals read answered)
 * gets no chip; the selected goal always keeps its chip so it can be cleared.
 */
export function goalFilterOptions(
  tasks: GoalTask[],
  missions: Project[],
  goals: GoalRow[] | undefined,
  selectedId: string | null = null,
): { id: string; title: string }[] {
  const status = new Map((goals ?? []).map((g) => [g.id, g.status]));
  const counts = new Map<string, { title: string; n: number }>();
  const add = (id: string, title: string | null | undefined) => {
    if (goals && status.get(id) !== "active") return;
    const cur = counts.get(id);
    if (cur) cur.n++;
    else if (title) counts.set(id, { title, n: 1 });
  };
  for (const m of missions) if (m.status === "ACTIVE" && m.lifeGoal) add(m.lifeGoal.id, m.lifeGoal.title);
  for (const t of tasks) if (t.goal && OPEN(t.status)) add(t.goal.id, t.goal.title);
  const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).map(([id, v]) => ({ id, title: v.title }));
  const shown = ranked.slice(0, GOAL_FILTER_CHIP_CAP);
  const selected = ranked.find((o) => o.id === selectedId);
  return selected && !shown.includes(selected) ? [...shown, selected] : shown;
}

export function goalFilterHref(goalId: string | null): string {
  return goalId ? `/missions?goalId=${encodeURIComponent(goalId)}` : "/missions";
}

/** goalId -> the pace the goal card shows (goalPaceView), in the shape hidden-risk reads. */
export function goalLineage(goals: GoalRow[], now: number = Date.now()): Map<string, GoalLineageEntry> {
  const iso = (d: string | Date | null) => (d == null ? null : typeof d === "string" ? d : d.toISOString());
  return new Map(
    goals.map((g) => {
      const view = goalPaceView({ ...g, deadline: iso(g.deadline), createdAt: iso(g.createdAt) ?? "" }, now);
      const paceKind = view?.kind === "chip" ? view.verdict.kind : "unscored";
      return [g.id, { title: g.title, horizon: g.horizon ?? undefined, paceKind }];
    }),
  );
}

/** hidden-risk reads `task.goalId`; hand it the resolved goal so an inherited one counts too. */
export function riskTasks<T extends GoalTask>(tasks: T[]): T[] {
  return tasks.map((t) => (t.goal && t.goal.id !== t.goalId ? { ...t, goalId: t.goal.id } : t));
}
