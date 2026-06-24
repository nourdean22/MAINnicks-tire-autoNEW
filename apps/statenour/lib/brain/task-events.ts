/**
 * TaskEvent — append-only log of task state changes.
 *
 * Apr 26 · The substrate for NOW-mode intelligence. Today the Task
 * row only holds "current state" — there's no history, so the brain
 * layer can't answer "how often does Nour skip THIS task?", "what
 * time of day does he actually complete bay-5 work?", or "which
 * categories has he abandoned in the last 14d?" Those questions
 * become trivial with this log.
 *
 * Design:
 *   · Append-only. Never updated, never deleted (prune via cron later).
 *   · Indexed by (taskId, createdAt) for per-task histories and
 *     (kind, createdAt) for cross-task pattern queries.
 *   · Fire-and-forget — failures NEVER break the calling write
 *     (logging telemetry shouldn't bring down a task creation).
 *
 * Kinds:
 *   created           - task came into existence
 *   started           - status → DOING
 *   completed         - status → DONE
 *   abandoned         - status → ARCHIVED without completion
 *   reframed          - title or nextPhysicalAction edited
 *   priority_changed  - autoPriority or manualPriorityOverride bumped
 *   linked            - bound to a customer / lead / decision / etc
 *   unlinked          - link removed
 *   nudged            - Nour saw a notification / chip about this task
 *   snoozed           - dueDate pushed forward
 *   stale_flagged     - card showed "STALE Nd" chip
 *   revived           - was archived/snoozed, now active again
 *   killed            - explicit "kill it" tap from stale chip
 */

import { prisma } from "@/lib/prisma";
import { idempotencyRecipe, idempotentCreate } from "@/lib/db/idempotency";
import { createHash } from "node:crypto";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/task-events");

export type TaskEventKind =
  | "created"
  | "started"
  | "completed"
  | "abandoned"
  | "reframed"
  | "priority_changed"
  | "linked"
  | "unlinked"
  | "nudged"
  | "snoozed"
  | "stale_flagged"
  | "revived"
  | "waiting"
  | "killed";

export interface TaskEventInput {
  taskId: string;
  kind: TaskEventKind;
  /** Source surface — "chat", "page", "cron", "voice", etc. */
  source?: string;
  /** Optional structured detail (e.g. priority_changed → {from, to}). */
  payload?: Record<string, unknown>;
}

/**
 * Fire-and-forget emit. Returns a promise but caller does NOT need to
 * await — failures are swallowed (logged to console only).
 *
 * v7.7 · Apr 29 · Idempotency wrapped. The same (taskId, kind,
 * payload) within a 60s bucket collides on the unique partial index,
 * suppressing duplicate event log rows from cron retries / network
 * blips / accidental double-fires.
 */
export async function emitTaskEvent(input: TaskEventInput): Promise<void> {
  try {
    const payloadHash = input.payload
      ? createHash("sha256").update(JSON.stringify(input.payload)).digest("hex").slice(0, 16)
      : "";
    const key = idempotencyRecipe.taskEvent({
      taskId: input.taskId,
      kind: input.kind,
      payloadHash,
      bucketSeconds: 60,
    });
    await idempotentCreate({
      model: prisma.taskEvent,
      key,
      data: {
        taskId: input.taskId,
        kind: input.kind,
        source: input.source ?? null,
        payload: (input.payload ?? null) as never,
        idempotencyKey: key,
      },
    });
  } catch (err) {
    log.warn("emit_failed", {
      kind: input.kind,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Synchronous fire-and-forget — caller doesn't even hold the promise. */
export function emitTaskEventAsync(input: TaskEventInput): void {
  void emitTaskEvent(input);
}

// ─── Aggregate queries (used by NOW-mode features) ──────────────

/**
 * How many times has the user skipped this task in the last N days?
 *
 * "Skipped" = the task was visible (status READY) at the start of a
 * day, was NOT moved to DOING/DONE that day, and the day rolled over.
 * For now we approximate: count `stale_flagged` events in the window.
 * When real day-rollover signal arrives we'll harden this.
 */
export async function getSkipCount(
  taskId: string,
  windowDays: number = 14,
): Promise<number> {
  try {
    const since = new Date(Date.now() - windowDays * 86400_000);
    return await prisma.taskEvent.count({
      where: {
        taskId,
        kind: "stale_flagged",
        createdAt: { gte: since },
      },
    });
  } catch {
    return 0;
  }
}

/**
 * "Done today" — count of completed events whose createdAt is today
 * (local server time). Used by the time-anchored stats line.
 */
export async function getDoneTodayCount(): Promise<number> {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return await prisma.taskEvent.count({
      where: {
        kind: "completed",
        createdAt: { gte: start },
      },
    });
  } catch {
    return 0;
  }
}

/**
 * Last completion timestamp (ms since epoch) per task — for the
 * "time-of-day fit" calculation. Returns 0 when no prior completion.
 */
export async function getLastCompletedAt(taskId: string): Promise<number> {
  try {
    const row = await prisma.taskEvent.findFirst({
      where: { taskId, kind: "completed" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return row ? row.createdAt.getTime() : 0;
  } catch {
    return 0;
  }
}

/**
 * Aggregate kill / abandon ratio per category-ish key. Used by the
 * future avoidance-pattern banner.
 *
 * Returns Map of `key → { killed, completed, total }` where `key` is
 * whatever the caller passes as group. Caller is responsible for
 * choosing a sensible group (e.g. mission domain, goalId, loopKind).
 */
export async function getAbandonmentRates(
  windowDays: number = 30,
): Promise<{ killed: number; completed: number; created: number }> {
  try {
    const since = new Date(Date.now() - windowDays * 86400_000);
    const rows = await prisma.taskEvent.groupBy({
      by: ["kind"],
      where: { createdAt: { gte: since }, kind: { in: ["killed", "completed", "created"] } },
      _count: { id: true },
    });
    const out = { killed: 0, completed: 0, created: 0 };
    for (const r of rows) {
      const k = r.kind as "killed" | "completed" | "created";
      out[k] = r._count.id;
    }
    return out;
  } catch {
    return { killed: 0, completed: 0, created: 0 };
  }
}
