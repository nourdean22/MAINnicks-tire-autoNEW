/**
 * Backfill and uncheck a DAILY habit for one ET calendar day.
 *
 * 2026-11-03 · Nour, from the bdnick chat: "I journaled on Oct 30 and Nov 2,
 * I just didn't click it." Nick could read the journal and see the gap but
 * had no tool that writes a dated check-off; checkTask only knows "now".
 *
 * A DAILY habit stores only streakCount + lastCompletedAt on the Task row;
 * the per-day history is the TaskEvent log (`completed` rows on every
 * check-off since 2026-08-23). The log is append-only (schema comment on
 * TaskEvent, FK Restrict), so an uncheck never deletes: it appends an
 * `uncompleted` event for that day, and a day counts as done while its
 * completed events outnumber its uncompleted ones. A backfill writes one
 * `completed` event stamped at that day's ET noon so every reader of the
 * log sees the true day.
 *
 * The streak: the row's incremental count is trusted for everything up to
 * its lastCompletedAt day (it includes the pre-event history); the event
 * days extend the run after that day, and can also prove the run ending AT
 * that day is longer than the row says (a hole that reset the count and
 * was then filled in).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { creditTaskStats } from "@/lib/mastery/goal-stats";
import { recordError } from "@/lib/errors/record-error";
import { invalidateMutationCaches } from "@/lib/services/tasks";
import { etMidnightToUtc, toDateString, today } from "@/lib/utils/datetime";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Nothing older than this is a habit correction; it is a data rewrite. */
export const BACKFILL_MAX_DAYS = 90;
/** Newest events read per task: 90 backfill days plus a long run is still under this. */
const EVENT_WINDOW = 600;

export function parseEtDay(date: string): { start: Date; end: Date; noon: Date } {
  if (!DATE_RE.test(date)) throw new ServiceError(`date must be YYYY-MM-DD, got "${date}"`, 400);
  const [y, m, d] = date.split("-").map(Number);
  const start = etMidnightToUtc(y, m, d);
  const end = etMidnightToUtc(y, m, d + 1);
  if (Number.isNaN(start.getTime()) || toDateString(start) !== date) {
    throw new ServiceError(`"${date}" is not a real calendar day`, 400);
  }
  return { start, end, noon: new Date(start.getTime() + 12 * 3_600_000) };
}

/** Whole ET days from `a` to `b` (both YYYY-MM-DD); positive when b is later. */
export function dayGap(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function prevDay(day: string): string {
  return new Date(Date.parse(day) - 86_400_000).toISOString().slice(0, 10);
}

async function loadDailyTask(id: string) {
  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, title: true, loopKind: true, goalId: true, streakCount: true, lastCompletedAt: true, deletedAt: true },
  });
  if (!task || task.deletedAt) throw new ServiceError("Task not found", 404);
  if (task.loopKind !== "DAILY") {
    throw new ServiceError(`"${task.title}" is ${task.loopKind}, not a DAILY habit; dated check-offs only apply to habits`, 400);
  }
  return task;
}

/** The ET day an event speaks for: an uncheck names its day in the payload. */
function eventDay(e: { kind: string; createdAt: Date; payload: unknown }): string {
  if (e.kind === "uncompleted") {
    const forDay = (e.payload as { forDay?: unknown } | null)?.forDay;
    if (typeof forDay === "string" && DATE_RE.test(forDay)) return forDay;
  }
  return toDateString(e.createdAt);
}

export interface DayCount { done: number; undone: number }
/** Per ET day: completed and uncompleted event counts, from the newest EVENT_WINDOW rows. */
export async function dayLedger(taskId: string): Promise<Map<string, DayCount>> {
  const rows = await prisma.taskEvent.findMany({
    where: { taskId, kind: { in: ["completed", "uncompleted"] } },
    select: { kind: true, createdAt: true, payload: true },
    orderBy: { createdAt: "desc" },
    take: EVENT_WINDOW,
  });
  const counts = new Map<string, DayCount>();
  for (const r of rows) {
    const day = eventDay(r);
    const c = counts.get(day) ?? { done: 0, undone: 0 };
    if (r.kind === "completed") c.done += 1;
    else c.undone += 1;
    counts.set(day, c);
  }
  return counts;
}

/** Days with a net completion, newest first. */
export function completedDays(ledger: ReadonlyMap<string, DayCount>): string[] {
  return [...ledger.entries()]
    .filter(([, c]) => c.done - c.undone > 0)
    .map(([d]) => d)
    .sort()
    .reverse();
}

/**
 * Streak ending at `latest`, given the completed day set plus the row's own
 * (lastCompletedAt day, streakCount). Walks back one day at a time. When the
 * walk reaches the row's day, the row's count covers the rest, unless the
 * event days prove a longer run ending there (a filled hole).
 */
export function streakEndingAt(
  latest: string,
  days: ReadonlySet<string>,
  row: { lastDay: string | null; streakCount: number },
): number {
  let run = 0;
  let cursor = latest;
  while (days.has(cursor) || cursor === row.lastDay) {
    if (cursor === row.lastDay) {
      let eventsRun = 1; // the row's day itself
      let back = prevDay(cursor);
      while (days.has(back)) {
        eventsRun += 1;
        back = prevDay(back);
      }
      return run + Math.max(1, row.streakCount, eventsRun);
    }
    run += 1;
    cursor = prevDay(cursor);
  }
  return run;
}

export interface BackfillResult {
  ok: true;
  taskId: string;
  completedOn: string;
  idempotent: boolean;
  streakCount: number;
  lastCompletedAt: Date | null;
  /** null = the XP credit failed (recorded), not "0 XP". */
  reward: { xpCredited: number; statsCredited: number } | null;
}

/**
 * Record that a DAILY habit was done on a past ET day. Today goes through
 * checkTask (same-day idempotency, the reward toast); the future and
 * anything older than BACKFILL_MAX_DAYS are refused.
 */
export async function backfillDailyCompletion(args: {
  id: string;
  completedOn: string;
  source?: string;
}): Promise<BackfillResult> {
  const { id, completedOn } = args;
  const day = parseEtDay(completedOn);
  const todayEt = today();
  const gapToToday = dayGap(completedOn, todayEt);
  if (gapToToday < 0) throw new ServiceError(`${completedOn} is in the future`, 400);
  if (gapToToday > BACKFILL_MAX_DAYS) {
    throw new ServiceError(`${completedOn} is more than ${BACKFILL_MAX_DAYS} days back; that is a data rewrite, not a habit correction`, 400);
  }
  if (gapToToday === 0) {
    const { checkTask } = await import("@/lib/services/task-actions");
    const r = await checkTask({ id, action: "complete", eventSource: args.source });
    // checkTask returns either the same-day idempotent shape (streakCount at the
    // top level) or the full shape (task row + reward).
    const row = "task" in r && r.task ? r.task : null;
    const reward = "reward" in r && r.reward ? r.reward : null;
    return {
      ok: true,
      taskId: id,
      completedOn,
      idempotent: "idempotent" in r && r.idempotent === true,
      streakCount:
        typeof row?.streakCount === "number"
          ? row.streakCount
          : "streakCount" in r && typeof r.streakCount === "number"
            ? r.streakCount
            : 0,
      lastCompletedAt:
        row && "lastCompletedAt" in row
          ? (row.lastCompletedAt ?? null)
          : "lastCompletedAt" in r
            ? (r.lastCompletedAt ?? null)
            : null,
      reward: reward ? { xpCredited: reward.xpCredited ?? 0, statsCredited: reward.statsCredited ?? 0 } : null,
    };
  }

  const task = await loadDailyTask(id);
  const lastDay = task.lastCompletedAt ? toDateString(task.lastCompletedAt) : null;
  const ledger = await dayLedger(id);
  const dayCount = ledger.get(completedOn) ?? { done: 0, undone: 0 };
  const net = dayCount.done - dayCount.undone;

  const idempotent = (): BackfillResult => ({
    ok: true,
    taskId: id,
    completedOn,
    idempotent: true,
    streakCount: task.streakCount,
    lastCompletedAt: task.lastCompletedAt,
    reward: { xpCredited: 0, statsCredited: 0 },
  });
  if (net > 0 || (lastDay === completedOn && net === 0)) return idempotent();

  const days = new Set(completedDays(ledger));
  days.add(completedOn);
  const latest = lastDay && dayGap(completedOn, lastDay) > 0 ? lastDay : completedOn;
  const streakCount = streakEndingAt(latest, days, { lastDay, streakCount: task.streakCount });
  const lastCompletedAt = latest === completedOn ? day.noon : task.lastCompletedAt;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.taskEvent.create({
        data: {
          taskId: id,
          goalId: task.goalId,
          kind: "completed",
          source: args.source ?? "service:backfillDailyCompletion",
          payload: { action: "complete", loopKind: "DAILY", recurring: true, backfilled: true, completedOn },
          // Deterministic per (task, day, number of unchecks so far): a racing
          // second backfill of the same day collides on the unique partial
          // index and reads as idempotent; a re-backfill after an uncheck gets
          // its own key.
          idempotencyKey: `backfill:${id}:${completedOn}:${dayCount.undone}`.slice(0, 64),
          createdAt: day.noon,
        },
      });
      await tx.task.update({
        where: { id },
        data: { streakCount, lastCompletedAt, lastTouchedAt: new Date() },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return idempotent();
    throw err;
  }
  invalidateMutationCaches();

  // Per-day XP, keyed on the backfilled day so it never double-credits. A
  // failed credit is recorded and reported as unknown, never as 0 XP.
  const reward = await creditTaskStats(id, { perDay: true, dayKey: completedOn }).catch((err: unknown) => {
    recordError("ai:tool-exec", err, { taskId: id, op: "daily-backfill.creditTaskStats", dayKey: completedOn });
    return null;
  });

  return { ok: true, taskId: id, completedOn, idempotent: false, streakCount, lastCompletedAt, reward };
}

export interface UncheckResult {
  ok: true;
  taskId: string;
  date: string;
  changed: boolean;
  streakCount: number;
  lastCompletedAt: Date | null;
}

/**
 * Take back a DAILY check-off for one ET day (a mis-tap, or a backfill that
 * was wrong). Appends an `uncompleted` event for the day and rewinds the row.
 * XP already credited for the day is left alone: it is idempotent per day,
 * so a later re-check of the same day credits nothing new.
 */
export async function uncheckDailyCompletion(args: { id: string; date?: string; source?: string }): Promise<UncheckResult> {
  const { id } = args;
  const date = args.date ?? today();
  parseEtDay(date);
  const task = await loadDailyTask(id);
  const lastDay = task.lastCompletedAt ? toDateString(task.lastCompletedAt) : null;
  const ledger = await dayLedger(id);
  const dayCount = ledger.get(date) ?? { done: 0, undone: 0 };
  const net = dayCount.done - dayCount.undone;
  const gap = lastDay ? dayGap(date, lastDay) : null; // >0: the day sits inside the run before lastDay

  const unchanged = (): UncheckResult => ({
    ok: true,
    taskId: id,
    date,
    changed: false,
    streakCount: task.streakCount,
    lastCompletedAt: task.lastCompletedAt,
  });

  // Was the day done at all? An event says so; with no event, only the row's
  // own run (its day and the streak before it) can vouch for it.
  const inRowRun = gap !== null && gap >= 0 && gap < Math.max(1, task.streakCount);
  if (net <= 0 && !inRowRun) return unchanged();

  let streakCount = task.streakCount;
  let lastCompletedAt = task.lastCompletedAt;
  if (gap === 0) {
    // The latest check-off goes; the run now ends at the newest remaining day.
    const remaining = completedDays(ledger).filter((d) => d !== date);
    const newLatest = remaining[0] ?? null;
    if (!newLatest) {
      streakCount = 0;
      lastCompletedAt = null;
    } else {
      // The row's count minus the day removed is trusted when the previous
      // day is the new end; otherwise only the event history can speak.
      const adjacent = dayGap(newLatest, lastDay!) === 1;
      streakCount = adjacent
        ? Math.max(0, task.streakCount - 1)
        : streakEndingAt(newLatest, new Set(remaining), { lastDay: null, streakCount: 0 });
      lastCompletedAt = parseEtDay(newLatest).noon;
    }
  } else if (gap !== null && gap > 0) {
    // A hole inside the run: the run ending at lastDay can be at most `gap` days long.
    streakCount = Math.min(task.streakCount, gap);
  }

  await prisma.$transaction(async (tx) => {
    await tx.taskEvent.create({
      data: {
        taskId: id,
        goalId: task.goalId,
        kind: "uncompleted",
        source: args.source ?? "service:uncheckDailyCompletion",
        payload: { action: "uncheck", loopKind: "DAILY", forDay: date },
      },
    });
    await tx.task.update({
      where: { id },
      data: { streakCount, lastCompletedAt, lastTouchedAt: new Date() },
    });
  });
  invalidateMutationCaches();
  return { ok: true, taskId: id, date, changed: true, streakCount, lastCompletedAt };
}
