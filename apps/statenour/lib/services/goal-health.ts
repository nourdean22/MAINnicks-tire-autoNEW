/**
 * Active goals with their pace and health, read once (job 2026-11-02-nour-os-interconnect W1 getGoals, moved here
 * in W6 so contextual recall reads the same shape instead of a second goals query).
 *
 * Health is goalHealthFrom (lib/brain/goal-pace.ts) with the horizon's cadence, the same function the goal card
 * uses, so Nick and the card never disagree: a check-in older than the cadence is no_check_in, an off-list stored
 * health is unknown, and a failed check-in read is unknown for every goal (never "no check-in").
 */
import { prisma } from "@/lib/prisma";
import { goalDue, goalHealthFrom, goalPaceView, type GoalHealthState } from "@/lib/brain/goal-pace";
import { NEXT_STEP_STATUSES } from "@/lib/services/goal-next-step";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/goal-health");

export interface ActiveGoalHealth {
  id: string;
  title: string;
  kind: string;
  horizon: string | null;
  unit: string;
  currentValue: number;
  targetValue: number;
  status: string;
  due: ReturnType<typeof goalDue>;
  pace: string | null;
  /** The pace verdict's kind ("behind", "missed", ...) when the goal has a scored chip, else null. */
  paceKind: string | null;
  health: { state: GoalHealthState; at: string | null };
  openTasks: number;
}

export async function activeGoalsWithHealth(now: number = Date.now()): Promise<{ goals: ActiveGoalHealth[]; failed: string[] }> {
  const goals = await prisma.lifeGoal.findMany({
    where: { status: "active", deletedAt: null },
    orderBy: [{ horizon: "asc" }, { progress: "desc" }],
    take: 20,
    select: {
      id: true, title: true, kind: true, horizon: true, unit: true, currentValue: true, targetValue: true,
      status: true, deadline: true, createdAt: true,
      _count: { select: { tasks: { where: { deletedAt: null, status: { in: [...NEXT_STEP_STATUSES] } } } } },
    },
  });
  const failed: string[] = [];
  const latest = new Map<string, { checkIn?: { payload: unknown; createdAt: Date }; horizonSetAt?: Date }>();
  try {
    const events = await prisma.goalEvent.findMany({
      where: { goalId: { in: goals.map((g) => g.id) }, kind: { in: ["check_in", "horizon_set"] } },
      // The newest row per (goal, kind): a cap across all goals would hide an older check-in as "none".
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
  } catch (err) {
    log.warn("check_in_read_failed", { err: err instanceof Error ? err.message : String(err) });
    failed.push("check_ins");
  }
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
      return {
        id: g.id,
        title: g.title,
        kind: g.kind,
        horizon: g.horizon,
        unit: g.unit,
        currentValue: g.currentValue,
        targetValue: g.targetValue,
        status: g.status,
        due: goalDue(dates),
        pace: view ? (view.kind === "note" ? view.text : view.label) : null,
        paceKind: view?.kind === "chip" ? view.verdict.kind : null,
        health: failed.length ? { state: "unknown", at: null } : { state: h.state, at: h.at },
        openTasks: g._count.tasks,
      };
    }),
    failed,
  };
}
