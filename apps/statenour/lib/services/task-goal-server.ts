/**
 * The ONE server-side task-goal rule (job 2026-11-02-nour-os-interconnect W8a; audit 02 A2/C2/C12).
 *
 * Linear L1: the goal link lives on the mission (`Mission.lifeGoalId`) and flows down to its tasks at
 * read time; a task's own `goalId` is the override. `lib/missions/task-goal.ts` is the client-safe
 * copy of that rule for the /missions board. This module is the server half:
 *
 *  - `goalTaskWhere(goalIds)`: the Prisma filter every goal COUNT reads through (goal card progress and
 *    next move, Nick's prompt "no next step", getGoals, the lift, the related-activity spine).
 *  - `taskGoalServer(task)`: the resolver every "which goal is this task for" read uses (journal day,
 *    weekly review, Home lead context, Nick's tools). Own goal if live, else the mission's if live.
 *
 * Both match goals by id only: a goal title inside a task title is never a key. There is no second
 * copy of either rule; W8b and W8c import these names.
 *
 * Ruling: a task whose own goal is archived counts for NO goal in `goalTaskWhere`, even when its
 * mission is goal-linked (the filter has no "own goal deleted" arm), while `taskGoalServer` falls back
 * to the mission's goal. Cost if wrong: an archived-goal task is missing from one mission's goal count
 * until it is re-aligned on /missions; the client rule in task-goal.ts behaves the same.
 */

/** Tasks that count for any of `goalIds`: their own goal, or (with no goal of their own) their mission's. */
export function goalTaskWhere(goalIds: readonly string[]) {
  const ids = [...goalIds];
  return { OR: [{ goalId: { in: ids } }, { goalId: null, mission: { lifeGoalId: { in: ids } } }] };
}

/** The Prisma `select` that gives `taskGoalServer` what it reads. */
export const TASK_GOAL_SELECT = {
  goal: { select: { id: true, title: true, deletedAt: true } },
  mission: { select: { lifeGoal: { select: { id: true, title: true, deletedAt: true } } } },
} as const;

export type GoalRef = { id: string; title: string; deletedAt: Date | null } | null | undefined;

export interface TaskGoalRow {
  goal?: GoalRef;
  mission?: { lifeGoal?: GoalRef } | null;
}

export interface ResolvedTaskGoal {
  id: string;
  title: string;
  /** "mission" = inherited from `Mission.lifeGoalId`; the mission card already shows it. */
  source: "task" | "mission";
}

const live = (g: GoalRef) => (g && !g.deletedAt ? g : null);

/** Own live goal, else the mission's live goal, else null. Reads ids and `deletedAt` only. */
export function taskGoalServer(task: TaskGoalRow): ResolvedTaskGoal | null {
  const own = live(task.goal);
  if (own) return { id: own.id, title: own.title, source: "task" };
  const inherited = live(task.mission?.lifeGoal);
  if (inherited) return { id: inherited.id, title: inherited.title, source: "mission" };
  return null;
}
