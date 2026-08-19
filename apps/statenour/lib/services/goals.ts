import { prisma } from "@/lib/prisma";
import { emitGoalEventAsync } from "@/lib/brain/goal-events";
import { emitGoalTransition } from "@/lib/db/brain-bus-emit";
import { softDelete, activeOnly } from "@/lib/db/soft-delete";
import { logCreate, logUpdate, stripNoise } from "@/lib/db/entity-audit";
import { effectiveGoalStats } from "@/lib/mastery/goal-stats";
import { validateParentLink, rollUpChildren } from "@/lib/mastery/goal-ladder";
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
  // 2026-05-27 · ghost-goal defense · `archive: true` is sugar for
  // `status: "paused" + soft-delete (deletedAt = now())` so the UI
  // archive button and the chat tool's archiveGoal both end up with
  // identical row state. Without this the UI archive only set status
  // and left deletedAt null — every `deletedAt:null` query (telegram
  // cmdGoals, ai-suggest-goals, page-data, etc.) kept surfacing the
  // "paused" goal back to the operator as a "ghost." See history of
  // the bug in MEMORY.md (Wave Z follow-up · 2026-05-27).
  // Ambition Engine P3 · the compounding ladder. null unlinks; a non-null
  // parent is validated (no self / cycle / inverted-horizon) in updateGoal.
  parentGoalId: z.string().nullable().optional(),
  // Ambition Engine P3 · kind (card shape) + anti-stale authoring — the
  // stolen-pattern columns (migrated in P1, dormant until now). conviction
  // 1-5; killBy is a DateTime (ISO); ambition is a tag; killCriteria /
  // identityLine are free text. All nullable so the edit panel can clear them.
  kind: z.enum(["metric", "milestone", "narrative"]).optional(),
  conviction: z.number().int().min(1).max(5).nullable().optional(),
  ambition: z.enum(["tenx", "incremental"]).nullable().optional(),
  killCriteria: z.string().max(500).nullable().optional(),
  killBy: z.string().datetime().nullable().optional(),
  identityLine: z.string().max(300).nullable().optional(),
  archive: z.boolean().optional(),
  restore: z.boolean().optional(),
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
    // Ambition Engine P1 · the goal's declared stat links (if any) so
    // each enriched row can carry its resolved mastery stats for the
    // GoalBoard chips. Shallow select keeps the AppRouter type flat.
    include: {
      statLinks: { select: { statKey: true, weight: true } },
      // Ambition Engine P3 · the compounding ladder — the parent this goal
      // rolls into + its (alive) children, fetched per-goal so a horizon
      // filter on the list never hides a cross-horizon ladder link.
      parent: { select: { id: true, title: true, horizon: true } },
      children: {
        where: { deletedAt: null },
        select: { id: true, title: true, progress: true, status: true, horizon: true },
        orderBy: [{ status: "asc" }, { progress: "desc" }],
      },
    },
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
    
    // 2026-06-01 · progress priority: task-based when the goal has tasks;
    // else metric-based when it has a real target; else 0. The old fallback
    // to the stored `g.progress` surfaced a stale 100% on unconfigured goals
    // (targetValue=0, no tasks) — the divide-by-zero display artifact.
    const hasTarget = (g.targetValue ?? 0) > 0;
    const computedProgress =
      total > 0
        ? Math.round((done / total) * 100)
        : hasTarget
          ? Math.min(100, Math.round(((g.currentValue ?? 0) / g.targetValue) * 100))
          : 0;

    const activeTasks = tasks.filter((t) =>
      ["INBOX", "READY", "DOING"].includes(t.status),
    );
    const nextMoveTask =
      activeTasks.find((t) => t.status === "DOING") ??
      [...activeTasks]
        .sort((a, b) => {
          // Canonical priority polarity is higher = more urgent. Unscored
          // tasks sink so a goal never promotes an unknown row over measured
          // work merely because it lacks a score.
          const ap = a.manualPriorityOverride ?? a.autoPriority ?? -1;
          const bp = b.manualPriorityOverride ?? b.autoPriority ?? -1;
          if (ap !== bp) return bp - ap;
          const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
          const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
          return ad - bd;
        })[0] ?? null;

    // Ambition Engine P1 · resolve the mastery stats this goal levels
    // (declared GoalStat rows, else domain-inferred) for the card chips.
    // statLinks is pulled out of the spread so the raw relation doesn't
    // ride along in the payload — only the resolved `stats` does.
    const { statLinks, parent, children, ...goalRest } = g;
    const stats = effectiveGoalStats(statLinks ?? [], g.domain);
    // Defensive: a goal fetched without the ladder include (or a test mock)
    // has no `children` relation — never assume it's an array.
    const childList = Array.isArray(children) ? children : [];
    return {
      ...goalRest,
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
      stats,
      // Ambition Engine P3 · ladder position for the card — parent breadcrumb
      // + children with a rolled-up summary ("3 sub-goals · 2 done · 64% avg").
      ladder: {
        parent: parent ?? null,
        children: childList,
        rollup: rollUpChildren(childList),
      },
    };
  });

  return enrichedGoals;
}

export async function createGoal(rawData: z.infer<typeof createGoalSchema>) {
  // 2026-05-27 · ghost-goal defense.
  // Operator surfaced "sometimes I see a second goal that I thought I
  // deleted." Root cause was a confluence of three things, this is one:
  // a double-tap on the UI Adopt / +Add button (or any retry path —
  // network blip, AI tool re-fire, manual create after AI created the
  // same goal) re-fired `createGoal()` with the same title and the DB
  // happily wrote a second row. The schema has no UNIQUE(title) on
  // LifeGoal (and shouldn't — different horizons can legitimately share
  // a title — "drop 5lb" as a WEEK goal vs a MONTH goal), so dedup has
  // to live in the service.
  //
  // Match is: case-insensitive title + same domain + alive (deletedAt
  // null) + status="active". A paused/achieved/missed/deleted goal
  // doesn't count — operator intentionally archived it and explicitly
  // re-creating it should yield a new active row. Returns the existing
  // row instead of creating a duplicate — idempotent, swallowed by the
  // UI's optimistic update, no toast surprise.
  const trimmedTitle = rawData.title.trim();
  const existing = await prisma.lifeGoal
    .findFirst({
      where: {
        domain: rawData.domain,
        title: { equals: trimmedTitle, mode: "insensitive" },
        status: "active",
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
    })
    .catch(() => null);

  if (existing) {
    return existing;
  }

  const goal = await prisma.lifeGoal.create({
    data: {
      domain: rawData.domain,
      title: trimmedTitle,
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
  const { id, progressDelta, archive, restore: restoreFlag, ...rawData } = parsed;
  const data: Record<string, unknown> = { ...rawData };

  if (rawData.deadline !== undefined) {
    data.deadline = rawData.deadline ? new Date(rawData.deadline) : null;
  }
  // Ambition Engine P3 · killBy is a DateTime column — convert like deadline
  // (conviction / ambition / killCriteria / identityLine pass through as-is).
  if (rawData.killBy !== undefined) {
    data.killBy = rawData.killBy ? new Date(rawData.killBy) : null;
  }

  // Ambition Engine P3 · validate the ladder link before writing parentGoalId.
  // null unlinks (no check). A non-null parent must exist (alive), not be self,
  // not create a cycle, and not be a shorter horizon than this goal.
  if (parsed.parentGoalId !== undefined && parsed.parentGoalId !== null) {
    const pid = parsed.parentGoalId;
    const all = await prisma.lifeGoal.findMany({
      where: { deletedAt: null },
      select: { id: true, horizon: true, parentGoalId: true },
    });
    if (!all.some((g) => g.id === pid)) throw new Error("Parent goal not found");
    const verdict = validateParentLink({
      goalId: id,
      parentGoalId: pid,
      horizonOf: new Map(all.map((g) => [g.id, g.horizon] as const)),
      parentOf: new Map(all.map((g) => [g.id, g.parentGoalId] as const)),
    });
    if (!verdict.ok) {
      throw new Error(
        verdict.reason === "self"
          ? "A goal cannot be its own parent"
          : verdict.reason === "cycle"
            ? "That link would create a goal-ladder cycle"
            : "A goal's parent must be a higher or equal time horizon",
      );
    }
  }

  // 2026-05-27 · ghost-goal defense.
  // `archive: true` → status="paused" + deletedAt=now() (matches the
  // chat tool's archiveGoal at lib/ai/tools/tasks.ts:750). `restore:
  // true` → status="active" + deletedAt=null. Explicit flags beat
  // implicit sugar so callers see exactly what they're asking for.
  if (archive) {
    data.status = "paused";
    data.deletedAt = new Date();
  }
  if (restoreFlag) {
    data.status = "active";
    data.deletedAt = null;
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
