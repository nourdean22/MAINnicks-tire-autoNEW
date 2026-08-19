/**
 * Task / loop / habit / mission action handlers.
 *
 * Extracted VERBATIM from lib/ai/nick-agent.ts executeAction (2026-06-02
 * structural split). The DAILY-streak logic (task.complete) and the
 * habit-toggle logic are moved byte-identically — they were just fixed
 * (C7 · 2026-06-02) and must not change.
 */
import { prisma } from "@/lib/prisma";
import { createTaskAndEnrich, liftGoalOnTaskComplete } from "@/lib/services/tasks";
import { creditTaskStats } from "@/lib/mastery/goal-stats";
import { recordError } from "@/lib/errors/record-error";
import { priorityFromLabel } from "@/lib/scoring/task-priority";
import type { ActionParams, ActionResult } from "./types";

// Apr 18: OpenLoop retired → task + loop cases all write Task
// INBOX rows against the m-inbox mission.
// 2026-08-19: the local 5/15/30/60 (lower = hotter) map was the writer
// that split autoPriority into two opposite scales — canonical mapping
// (higher = more urgent) now lives in lib/scoring/task-priority.
const priorityFor = priorityFromLabel;

export async function handleTaskCreate(params: ActionParams, type: string): Promise<ActionResult> {
  const task = await createTaskAndEnrich({
    title: String(params.title || "Untitled task"),
    missionId: "m-inbox",
    status: "INBOX",
    nextPhysicalAction: String(params.title || "Untitled task"),
    effort: "M15",
    roiScore: 50,
    frictionScore: 50,
    energyRequired: "MEDIUM",
    context: "ANYWHERE",
    finishCondition: params.description ? String(params.description) : "done when complete",
    autoPriority: priorityFor(params.priority),
    autoPriorityExplanation: `from nick-agent (${type})${params.domain ? ` · ${params.domain}` : ""}`,
    lastTouchedAt: new Date(),
  });
  return { action: type, success: true, result: { id: task.id, title: task.title } };
}

export async function handleTaskComplete(params: ActionParams, type: string): Promise<ActionResult> {
  const id = String(params.id);
  // 2026-06-02 · C7 fix · DAILY tasks must NOT be hard-set to DONE —
  // that destroys the streak. Mirror completeTask's DAILY branch
  // (lib/ai/tools/tasks.ts): bump streak via gap-check + stay READY.
  const existing = await prisma.task.findUnique({
    where: { id },
    select: { loopKind: true, streakCount: true, lastCompletedAt: true, goalId: true, title: true },
  });
  if (!existing) {
    return { action: type, success: false, error: "task not found" };
  }
  const now = new Date();
  const explanation =
    type === "loop.close" && params.reason
      ? `closed: ${String(params.reason)}`
      : "completed via nick agent";

  let task: { id: string; title: string; goalId: string | null };
  if (existing.loopKind === "DAILY") {
    // Same streak logic as completeTask / the /check route: local-day
    // gap — 0 = already done today (idempotent), 1 = increment, else reset.
    let nextStreak = 1;
    if (existing.lastCompletedAt) {
      const last = new Date(existing.lastCompletedAt);
      const lastStart = new Date(last.getFullYear(), last.getMonth(), last.getDate());
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const gap = Math.round((todayStart.getTime() - lastStart.getTime()) / 86_400_000);
      if (gap === 0) {
        return {
          action: type,
          success: true,
          result: {
            id,
            title: existing.title,
            loopKind: "DAILY",
            idempotent: true,
            streakCount: existing.streakCount,
            note: "already checked off today · streak preserved",
          },
        };
      }
      nextStreak = gap === 1 ? existing.streakCount + 1 : 1;
    }
    task = await prisma.task.update({
      where: { id },
      data: {
        lastCompletedAt: now,
        lastTouchedAt: now,
        streakCount: nextStreak,
        status: "READY", // DAILY stays in the loop
        snoozedUntil: null,
        autoPriorityExplanation: explanation,
      },
      select: { id: true, title: true, goalId: true },
    });
  } else {
    task = await prisma.task.update({
      where: { id },
      data: {
        status: "DONE",
        lastCompletedAt: now,
        lastTouchedAt: now,
        autoPriorityExplanation: explanation,
      },
      select: { id: true, title: true, goalId: true },
    });
  }
  // 2026-06-01 · credit character-sheet stat XP + lift the linked goal
  // (this action path bypasses checkTask/updateTask). Idempotent.
  // 2026-06-02 · was fire-and-forget `void` — a throw silently lost
  // XP/goal-lift. Now awaited via allSettled; rejections are logged,
  // but a failure here never blocks the user-facing action result.
  const settled = await Promise.allSettled([
    creditTaskStats(id),
    ...(task.goalId ? [liftGoalOnTaskComplete(task.goalId, id)] : []),
  ]);
  for (const r of settled) {
    if (r.status === "rejected") {
      recordError("ai:tool-exec", r.reason, { taskId: id, actionType: type, op: "task.complete-sideeffect" });
    }
  }
  return { action: type, success: true, result: { id: task.id, title: task.title } };
}

export async function handleHabitToggle(params: ActionParams, type: string): Promise<ActionResult> {
  // v10.0.59 · Wave A part 2 · Pre-fix dead Promise.resolve
  // placeholders for the retired HabitLog table. Habits now
  // live as DAILY-loop Tasks; toggling a habit means flipping
  // the matching task's lastCompletedAt + bumping streakCount.
  const habitKey = String(params.habitKey || "").trim();
  if (!habitKey) {
    return { action: type, success: false, error: "habitKey required" };
  }
  const task = await prisma.task.findFirst({
    where: {
      loopKind: "DAILY",
      deletedAt: null,
      title: { equals: habitKey, mode: "insensitive" },
    },
    select: { id: true, streakCount: true, lastCompletedAt: true },
  });
  if (!task) {
    // Task model has many required fields (missionId,
    // nextPhysicalAction, effort, roiScore, frictionScore,
    // energyRequired, context, finishCondition) which can't
    // be inferred from a habit toggle. Surface a clear error
    // rather than silently dropping or pretending success.
    // Operator creates DAILY tasks via /tasks UI which has
    // the proper form.
    return {
      action: type,
      success: false,
      error: `No DAILY task with title "${habitKey}". Create it on /tasks first; the toggle will work after.`,
    };
  }
  // Toggle: if completed today, un-complete; otherwise complete.
  const todayStartET = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }) +
      "T00:00:00",
  );
  const completedToday =
    task.lastCompletedAt && task.lastCompletedAt >= todayStartET;
  await prisma.task.update({
    where: { id: task.id },
    data: completedToday
      ? {
          streakCount: { decrement: 1 },
          lastCompletedAt: null,
          lastTouchedAt: new Date(),
        }
      : {
          streakCount: { increment: 1 },
          lastCompletedAt: new Date(),
          lastTouchedAt: new Date(),
        },
  });
  return {
    action: type,
    success: true,
    result: {
      habitKey,
      taskId: task.id,
      action: completedToday ? "uncompleted" : "completed",
      streakDelta: completedToday ? -1 : 1,
    },
  };
}

export async function handleMissionPlan(params: ActionParams, type: string): Promise<ActionResult> {
  const tasks = Array.isArray(params.tasks) ? params.tasks : [];
  const domainMap: Record<string, string> = { business: "BUSINESS", personal: "PERSONAL", health: "HEALTH", content: "CONTENT", finance: "FINANCE" };
  const domain = domainMap[String(params.domain || "business").toLowerCase()] || "BUSINESS";
  const prio = Number(params.priority ?? 50);
  const mission = await prisma.mission.create({
    data: {
      title: String(params.title || "New Mission"),
      domain: domain as any,
      priority: prio,
      roiScore: prio,
      neglectCost: Math.round(prio * 0.7),
      successMetric: params.successMetric ? String(params.successMetric) : null,
      status: "ACTIVE",
    },
  });
  const createdTasks = [];
  for (let i = 0; i < tasks.length; i++) {
    const t: any = tasks[i];
    const task = await createTaskAndEnrich({
      title: String(t.title || `Task ${i + 1}`),
      missionId: mission.id,
      nextPhysicalAction: String(t.nextPhysicalAction || t.title || "Define next step"),
      effort: (t.effort || "M30") as any,
      context: (t.context || "ANYWHERE") as any,
      finishCondition: String(t.title || `Task ${i + 1}`),
      roiScore: Math.max(10, 90 - i * 10),
      frictionScore: 30,
      energyRequired: "MEDIUM",
    });
    createdTasks.push(task);
  }
  return { action: type, success: true, result: {
    missionId: mission.id, title: mission.title, taskCount: createdTasks.length,
    tasks: createdTasks.map(t => ({ id: t.id, title: t.title })),
  }};
}

export async function handleTaskStatus(params: ActionParams, type: string): Promise<ActionResult> {
  // 2026-06-06 · Lets Nick CHECK a task/habit's real status instead of
  // asserting it from memory. The reviewed chat fabricated "you didn't do
  // them" with no tool call · the response-verifier flagged it. No new
  // columns selected, so this is safe to deploy ahead of the recurringDays
  // migration.
  const query = String(params.title ?? params.query ?? "").trim();
  if (!query) {
    return { action: type, success: false, error: "Provide the task/habit title to check." };
  }
  const matches = await prisma.task.findMany({
    where: { deletedAt: null, title: { contains: query, mode: "insensitive" } },
    select: {
      id: true,
      title: true,
      status: true,
      loopKind: true,
      streakCount: true,
      lastCompletedAt: true,
      dueDate: true,
    },
    orderBy: { lastTouchedAt: "desc" },
    take: 5,
  });
  if (matches.length === 0) {
    return {
      action: type,
      success: true,
      result: {
        query,
        found: false,
        note: `No task matching "${query}" on Nour's list. Tell him you don't see it — do NOT assume whether it's done.`,
      },
    };
  }
  // "Done today" in Nour's timezone (ET) · mirrors handleHabitToggle's anchor.
  const todayStartET = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }) + "T00:00:00",
  );
  const tasks = matches.map((t) => {
    const recurring = t.loopKind === "DAILY" || t.loopKind === "WEEKLY";
    const completedToday = !!t.lastCompletedAt && t.lastCompletedAt >= todayStartET;
    return {
      title: t.title,
      loopKind: t.loopKind,
      status: t.status,
      doneToday: recurring ? completedToday : t.status === "DONE",
      streakCount: t.streakCount,
      lastCompletedAt: t.lastCompletedAt ? t.lastCompletedAt.toISOString() : null,
      dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    };
  });
  return { action: type, success: true, result: { query, found: true, count: tasks.length, tasks } };
}
