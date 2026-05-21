import { prisma } from "@/lib/prisma";
import { emitGoalEventAsync } from "@/lib/brain/goal-events";
import { emitGoalTransition } from "@/lib/db/brain-bus-emit";
import { softDelete, activeOnly } from "@/lib/db/soft-delete";
import { logCreate, logUpdate, stripNoise } from "@/lib/db/entity-audit";
import { z } from "zod";

export const HORIZON_VALUES = ["DAY", "WEEK", "MONTH", "QUARTER", "YEAR", "LIFE"] as const;

export const createGoalSchema = z.object({
  domain: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  metric: z.string().max(200).optional(),
  targetValue: z.number().optional(),
  unit: z.string().max(50).optional(),
  deadline: z.string().datetime().optional().nullable(),
  horizon: z.enum(HORIZON_VALUES).optional(),
  why: z.string().max(2000).optional().nullable(),
});

export const updateGoalSchema = z.object({
  id: z.string().min(1),
  domain: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(200).optional(),
  metric: z.string().max(200).optional(),
  targetValue: z.number().optional(),
  currentValue: z.number().optional(),
  progressDelta: z.number().optional(),
  unit: z.string().max(50).optional(),
  deadline: z.string().datetime().optional().nullable(),
  progress: z.number().min(0).max(100).optional(),
  status: z.enum(["active", "completed", "abandoned", "achieved", "missed", "paused"]).optional(),
  horizon: z.enum(HORIZON_VALUES).optional(),
  why: z.string().max(2000).optional().nullable(),
});

export async function getGoals(options: { horizon?: string | null, domain?: string | null, includeDeleted?: boolean } = {}) {
  const { horizon, domain, includeDeleted } = options;
  const where: Record<string, unknown> = {};
  if (horizon && (HORIZON_VALUES as readonly string[]).includes(horizon)) {
    where.horizon = horizon;
  }
  if (domain) where.domain = domain;
  if (!includeDeleted) where.deletedAt = null;

  const goals = await prisma.lifeGoal.findMany({
    where,
    orderBy: [{ status: "asc" }, { progress: "desc" }],
  });

  const goalIds = goals.map((g) => g.id);
  const linkedTasks = goalIds.length
    ? await prisma.task.findMany({
        where: activeOnly({ goalId: { in: goalIds } }),
        select: {
          id: true,
          title: true,
          goalId: true,
          status: true,
          loopKind: true,
          streakCount: true,
          lastCompletedAt: true,
          actualMinutes: true,
          autoPriority: true,
          manualPriorityOverride: true,
          dueDate: true,
        },
      })
    : [];

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);
  const weeklyCompletes = new Map<string, number>();
  if (goalIds.length > 0) {
    try {
      const recentEvents = await prisma.taskEvent.findMany({
        where: {
          kind: "completed",
          createdAt: { gte: sevenDaysAgo },
          task: { goalId: { in: goalIds } },
        },
        select: { task: { select: { goalId: true } } },
      });
      for (const e of recentEvents) {
        const gid = e.task?.goalId;
        if (!gid) continue;
        weeklyCompletes.set(gid, (weeklyCompletes.get(gid) ?? 0) + 1);
      }
    } catch (err) {
      console.warn(
        "[services/goals] weekly completes query failed (table missing?):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const byGoal = new Map<string, typeof linkedTasks>();
  for (const t of linkedTasks) {
    if (!t.goalId) continue;
    const list = byGoal.get(t.goalId) || [];
    list.push(t);
    byGoal.set(t.goalId, list);
  }

  const enrichedGoals = goals.map((g) => {
    const tasks = byGoal.get(g.id) || [];
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "DONE").length;
    const active = tasks.filter((t) =>
      ["INBOX", "READY", "DOING"].includes(t.status)
    ).length;
    const minutesInvested = tasks.reduce(
      (sum, t) => sum + (t.actualMinutes || 0),
      0
    );
    
    const computedProgress =
      total > 0 ? Math.round((done / total) * 100) : g.progress;

    const activeTasks = tasks.filter((t) =>
      ["INBOX", "READY", "DOING"].includes(t.status),
    );
    const nextMoveTask =
      activeTasks.find((t) => t.status === "DOING") ??
      [...activeTasks]
        .sort((a, b) => {
          const ap = a.manualPriorityOverride ?? a.autoPriority ?? 100;
          const bp = b.manualPriorityOverride ?? b.autoPriority ?? 100;
          if (ap !== bp) return ap - bp;
          const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
          const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
          return ad - bd;
        })[0] ?? null;

    return {
      ...g,
      progress: computedProgress,
      linkedTaskCount: total,
      linkedDoneCount: done,
      linkedActiveCount: active,
      minutesInvested,
      nextMove: nextMoveTask
        ? {
            id: nextMoveTask.id,
            title: nextMoveTask.title,
            status: nextMoveTask.status,
          }
        : null,
      loopsThisWeek: weeklyCompletes.get(g.id) ?? 0,
    };
  });

  return enrichedGoals;
}

export async function createGoal(rawData: z.infer<typeof createGoalSchema>) {
  const goal = await prisma.lifeGoal.create({
    data: {
      domain: rawData.domain,
      title: rawData.title,
      metric: rawData.metric ?? "",
      targetValue: rawData.targetValue ?? 0,
      unit: rawData.unit || "",
      deadline: rawData.deadline ? new Date(rawData.deadline) : null,
      horizon: rawData.horizon ?? null,
      why: rawData.why ?? null,
    },
  });
  
  emitGoalEventAsync({ goalId: goal.id, kind: "created", source: "api:goals.POST" });
  
  void logCreate("lifeGoal", goal.id, goal as unknown as Record<string, unknown>, {
    source: "api:goals.POST",
  });
  
  return goal;
}

export async function updateGoal(parsed: z.infer<typeof updateGoalSchema>) {
  const { id, progressDelta, ...rawData } = parsed;
  const data: Record<string, unknown> = { ...rawData };

  if (rawData.deadline !== undefined) {
    data.deadline = rawData.deadline ? new Date(rawData.deadline) : null;
  }

  const before = await prisma.lifeGoal.findUnique({ where: { id } });
  if (!before) throw new Error("Goal not found");

  let nextCurrent: number | undefined;
  if (typeof rawData.currentValue === "number") {
    nextCurrent = Math.max(0, rawData.currentValue);
  } else if (typeof progressDelta === "number" && progressDelta !== 0) {
    nextCurrent = Math.max(0, before.currentValue + progressDelta);
  }
  if (nextCurrent !== undefined) {
    // currentValue write: a positive progressDelta uses an atomic
    // `{ increment }` so concurrent "+N" updates don't lose each other
    // (the read-then-write race). Explicit sets + negative deltas keep
    // the computed absolute value — a negative delta needs the
    // Math.max(0) floor that `increment` cannot express. progress/status
    // below stay derived from the optimistic nextCurrent; they self-heal
    // on the next write if a concurrent increment raced.
    const atomicBump =
      typeof rawData.currentValue !== "number" &&
      typeof progressDelta === "number" &&
      progressDelta > 0;
    data.currentValue = atomicBump ? { increment: progressDelta } : nextCurrent;
    const target = rawData.targetValue ?? before.targetValue;
    if (target > 0) {
      data.progress = Math.min(100, Math.round((nextCurrent / target) * 100));
    }
    if (target > 0 && nextCurrent >= target && before.status !== "achieved") {
      data.status = "achieved";
      data.achievedAt = new Date();
    }
  }

  const goal = await prisma.lifeGoal.update({ where: { id }, data });

  void logUpdate(
    "lifeGoal",
    id,
    stripNoise(before as unknown as Record<string, unknown>),
    stripNoise(goal as unknown as Record<string, unknown>),
    { source: "api:goals.PATCH" },
  );

  if (goal.status !== before.status) {
    void emitGoalTransition({
      goalId: id,
      oldStatus: before.status,
      newStatus: goal.status,
      title: goal.title,
      domain: goal.domain ?? null,
      horizon: goal.horizon ?? null,
      transitionedAt: new Date().toISOString(),
    });
  }

  if (nextCurrent !== undefined && nextCurrent !== before.currentValue) {
    emitGoalEventAsync({
      goalId: id,
      kind: "progress_logged",
      source: "api:goals.PATCH",
      payload: {
        delta: nextCurrent - before.currentValue,
        before: before.currentValue,
        after: nextCurrent,
        target: goal.targetValue,
      },
    });
  }
  if (data.status === "achieved" && before.status !== "achieved") {
    emitGoalEventAsync({ goalId: id, kind: "achieved", source: "api:goals.PATCH" });
  }
  if (data.status === "paused" && before.status !== "paused") {
    emitGoalEventAsync({ goalId: id, kind: "paused", source: "api:goals.PATCH" });
  }
  if (data.status === "active" && before.status === "paused") {
    emitGoalEventAsync({ goalId: id, kind: "resumed", source: "api:goals.PATCH" });
  }
  
  if (
    rawData.title !== undefined ||
    rawData.deadline !== undefined ||
    rawData.targetValue !== undefined ||
    rawData.why !== undefined ||
    rawData.horizon !== undefined ||
    rawData.metric !== undefined
  ) {
    emitGoalEventAsync({
      goalId: id,
      kind: "updated",
      source: "api:goals.PATCH",
      payload: { fields: Object.keys(rawData).filter((k) => rawData[k as keyof typeof rawData] !== undefined) },
    });
  }

  return goal;
}

export async function removeGoal(id: string) {
  const result = await softDelete("lifeGoal", { id });
  return { ok: result.ok, soft: true, noop: result.noop };
}
