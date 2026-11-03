/**
 * Active goals with their pace, health and the ONE goal number, read once (job 2026-11-02-nour-os-interconnect W1
 * getGoals, moved here in W6 so contextual recall reads the same shape instead of a second goals query; W8a adds
 * the task counts through `goalTaskWhere` and `goalProgress`, so Nick's prompt, the goals-page grounding, getGoals
 * and the card compute the same percentage).
 *
 * Health is goalHealthFrom (lib/brain/goal-pace.ts) with the horizon's cadence, the same function the goal card
 * uses, so Nick and the card never disagree: a check-in older than the cadence is no_check_in, an off-list stored
 * health is unknown, and a failed check-in read is unknown for every goal (never "no check-in"). A failed tasks
 * read leaves the counts null (named in `failed`), never zero.
 */
import { prisma } from "@/lib/prisma";
import { goalDue, goalHealthFrom, goalPaceView, type GoalHealthState } from "@/lib/brain/goal-pace";
import { NEXT_STEP_STATUSES } from "@/lib/services/goal-next-step";
import { goalTaskWhere } from "@/lib/services/task-goal-server";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/goal-health");

/** Active goals the prompt, recall and Nick's getGoals read (3 active in prod, 2026-11-03). */
export const ACTIVE_GOALS_CAP = 20;

export interface ActiveGoalHealth {
  id: string;
  title: string;
  kind: string;
  domain: string;
  metric: string;
  horizon: string | null;
  unit: string;
  currentValue: number;
  targetValue: number;
  status: string;
  deadline: string | null;
  createdAt: string;
  due: ReturnType<typeof goalDue>;
  pace: string | null;
  /** The pace verdict's kind ("behind", "missed", ...) when the goal has a scored chip, else null. */
  paceKind: string | null;
  health: { state: GoalHealthState; at: string | null };
  /** Open tasks that count for this goal (own goalId, or none and the mission's); null = the tasks read failed. */
  openTasks: number | null;
  tasksDone: number | null;
  tasksTotal: number | null;
  /** goalProgress; null only when it would need the tasks and their read failed. */
  progress: number | null;
}

/**
 * The one goal number (audit A5/C1): a metric goal with a target is its value %; every other goal is its task %
 * over the tasks goalTaskWhere counts; a goal with neither is 0. The stored `progress` column is never read.
 */
export function goalProgress(g: { kind: string | null | undefined; targetValue: number; currentValue: number; done: number; total: number }): number {
  if (g.kind === "metric" && g.targetValue > 0) return Math.min(100, Math.round((g.currentValue / g.targetValue) * 100));
  if (g.total > 0) return Math.round((g.done / g.total) * 100);
  if (g.targetValue > 0) return Math.min(100, Math.round((g.currentValue / g.targetValue) * 100));
  return 0;
}

export interface LatestGoalEvents {
  checkIn?: { payload: unknown; createdAt: Date };
  horizonSetAt?: Date;
}

/**
 * The newest check_in and horizon_set GoalEvent per goal, in one read. getGoals, activeGoalsWithHealth and (W8b)
 * the Home check-in row share it; a cap across goals would hide an older check-in as "none", so none is applied.
 * Throws on a failed read: the caller decides what "unknown" looks like on its surface.
 */
export async function latestGoalEvents(goalIds: readonly string[]): Promise<Map<string, LatestGoalEvents>> {
  const latest = new Map<string, LatestGoalEvents>();
  if (goalIds.length === 0) return latest;
  const events = await prisma.goalEvent.findMany({
    where: { goalId: { in: [...goalIds] }, kind: { in: ["check_in", "horizon_set"] } },
    orderBy: { createdAt: "desc" },
    distinct: ["goalId", "kind"],
    select: { goalId: true, kind: true, payload: true, createdAt: true },
  });
  for (const e of events) {
    const row = latest.get(e.goalId) ?? {};
    if (e.kind === "check_in" && !row.checkIn) row.checkIn = { payload: e.payload, createdAt: e.createdAt };
    if (e.kind === "horizon_set" && !row.horizonSetAt) row.horizonSetAt = e.createdAt;
    latest.set(e.goalId, row);
  }
  return latest;
}

interface GoalTaskCounts {
  open: number;
  done: number;
  total: number;
}

/** Per-goal task counts over goalTaskWhere (own goal, else the mission's). Throws on a failed read. */
export async function goalTaskCounts(goalIds: readonly string[]): Promise<Map<string, GoalTaskCounts>> {
  const counts = new Map<string, GoalTaskCounts>();
  if (goalIds.length === 0) return counts;
  const rows = await prisma.task.findMany({
    where: { deletedAt: null, ...goalTaskWhere(goalIds) },
    select: { goalId: true, status: true, mission: { select: { lifeGoalId: true } } },
  });
  const open = new Set<string>(NEXT_STEP_STATUSES);
  for (const t of rows) {
    const gid = t.goalId ?? t.mission?.lifeGoalId;
    if (!gid) continue;
    const c = counts.get(gid) ?? { open: 0, done: 0, total: 0 };
    c.total++;
    if (t.status === "DONE") c.done++;
    if (open.has(t.status)) c.open++;
    counts.set(gid, c);
  }
  return counts;
}

export async function activeGoalsWithHealth(now: number = Date.now()): Promise<{ goals: ActiveGoalHealth[]; failed: string[] }> {
  const goals = await prisma.lifeGoal.findMany({
    where: { status: "active", deletedAt: null },
    orderBy: [{ horizon: "asc" }, { progress: "desc" }],
    take: ACTIVE_GOALS_CAP,
    select: {
      id: true, title: true, kind: true, domain: true, metric: true, horizon: true, unit: true, currentValue: true, targetValue: true,
      status: true, deadline: true, createdAt: true,
    },
  });
  const ids = goals.map((g) => g.id);
  const failed: string[] = [];
  let latest = new Map<string, LatestGoalEvents>();
  try {
    latest = await latestGoalEvents(ids);
  } catch (err) {
    log.warn("check_in_read_failed", { err: err instanceof Error ? err.message : String(err) });
    failed.push("check_ins");
  }
  let counts: Map<string, GoalTaskCounts> | null = null;
  try {
    counts = await goalTaskCounts(ids);
  } catch (err) {
    log.warn("tasks_read_failed", { err: err instanceof Error ? err.message : String(err) });
    failed.push("tasks");
  }
  const eventsFailed = failed.includes("check_ins");
  return {
    goals: goals.map((g) => {
      const l = latest.get(g.id);
      const dates = {
        deadline: g.deadline?.toISOString() ?? null,
        horizon: g.horizon,
        createdAt: g.createdAt.toISOString(),
        horizonSetAt: l?.horizonSetAt?.toISOString() ?? null,
      };
      const view = goalPaceView({ ...dates, currentValue: g.currentValue, targetValue: g.targetValue, unit: g.unit, status: g.status }, now);
      const h = goalHealthFrom(l?.checkIn ?? null, g.horizon, now);
      const c = counts?.get(g.id) ?? (counts ? { open: 0, done: 0, total: 0 } : null);
      // A metric goal's number needs no tasks; any other goal's does.
      const metricNumber = g.kind === "metric" && g.targetValue > 0;
      return {
        id: g.id,
        title: g.title,
        kind: g.kind,
        domain: g.domain,
        metric: g.metric,
        horizon: g.horizon,
        unit: g.unit,
        currentValue: g.currentValue,
        targetValue: g.targetValue,
        status: g.status,
        deadline: dates.deadline,
        createdAt: dates.createdAt,
        due: goalDue(dates),
        // A failed event read also lost horizon_set, so the pace would count from creation: no pace, not a guess.
        pace: eventsFailed ? null : view ? (view.kind === "note" ? view.text : view.label) : null,
        paceKind: !eventsFailed && view?.kind === "chip" ? view.verdict.kind : null,
        health: eventsFailed ? { state: "unknown", at: null } : { state: h.state, at: h.at },
        openTasks: c ? c.open : null,
        tasksDone: c ? c.done : null,
        tasksTotal: c ? c.total : null,
        progress: c || metricNumber ? goalProgress({ kind: g.kind, targetValue: g.targetValue, currentValue: g.currentValue, done: c?.done ?? 0, total: c?.total ?? 0 }) : null,
      };
    }),
    failed,
  };
}
