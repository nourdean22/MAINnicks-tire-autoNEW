/**
 * GoalEvent — append-only log of goal progress + lifecycle.
 *
 * Apr 27 · S1. The PLAN-tab substrate that lets goals answer:
 *   · "How fast is this goal moving?"
 *   · "What's the rolling weekly delta?"
 *   · "When did I last touch it?"
 *   · "Did the milestone-hit moment actually land?"
 *
 * Mirrors lib/brain/task-events.ts so the two logs follow the same
 * shape — fire-and-forget emit, indexed aggregate queries, never
 * throws into the calling write path.
 *
 * Kinds:
 *   created           - goal came into existence
 *   updated           - any field changed (title, why, deadline, etc)
 *   progress_logged   - currentValue bumped (manual or auto from task)
 *   milestone_set     - planData.milestones was edited
 *   milestone_hit     - currentValue crossed a milestone threshold
 *   coached           - Nick added a coachLog entry
 *   paused            - status → paused
 *   resumed           - status paused → active
 *   achieved          - status → achieved (currentValue ≥ targetValue)
 *   missed            - status → missed (deadline passed unmet)
 *   linked_project    - a Mission was bound via tasks with this goalId
 *   unlinked_project  - last task with this goalId removed
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { idempotencyRecipe, idempotentCreate } from "@/lib/db/idempotency";
import { createHash } from "node:crypto";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/goal-events");

/** The source of the nightly shop sync's value events (lib/services/goal-shop-sync.ts). */
export const SHOP_SYNC_SOURCE = "shop-bridge";
/**
 * progress_logged rows that Nour's own actions wrote ("goals lifted today", "loops this week"): the shop sync's
 * values are not his doing. Spelled with an OR because SQL `source <> 'x'` is not true for a NULL source.
 */
export const OWN_PROGRESS_WHERE = {
  OR: [{ source: null }, { source: { not: SHOP_SYNC_SOURCE } }],
} satisfies Prisma.GoalEventWhereInput;

export type GoalEventKind =
  | "created"
  | "updated"
  | "progress_logged"
  | "milestone_set"
  | "milestone_hit"
  | "coached"
  | "paused"
  | "resumed"
  | "achieved"
  | "missed"
  | "linked_project"
  | "unlinked_project"
  /** The horizon changed (payload { from, to }); a derived due date counts from here. */
  | "horizon_set"
  /** Nour's check-in (payload { health, value?, note, day }); written by Nick's logGoalCheckIn, one per goal per ET day. */
  | "check_in"
  /** A linked task finished on a metric goal (payload { taskId }): recorded, but the value is not moved (W2 2026-11-02). */
  | "task_completed";

export interface GoalEventInput {
  goalId: string;
  kind: GoalEventKind;
  /** Source surface (page, chat, cron, task-completion-hook). */
  source?: string;
  /** Optional structured payload (e.g. progress_logged → { delta, after }). */
  payload?: Record<string, unknown>;
}

/**
 * Fire-and-forget emit. Never throws — telemetry must not break the
 * caller's mutation path.
 *
 * v7.7 · Apr 29 · Idempotency wrapped. Same (goalId, kind, payload)
 * within 60s collides on the unique partial index, so cron retries
 * and accidental double-emits don't pollute the event log.
 */
export async function emitGoalEvent(input: GoalEventInput): Promise<void> {
  try {
    const payloadHash = input.payload
      ? createHash("sha256").update(JSON.stringify(input.payload)).digest("hex").slice(0, 16)
      : "";
    const key = idempotencyRecipe.goalEvent({
      goalId: input.goalId,
      kind: input.kind,
      payloadHash,
      bucketSeconds: 60,
    });
    const res = await idempotentCreate<{ id: string }, unknown>({
      model: prisma.goalEvent,
      key,
      data: {
        goalId: input.goalId,
        kind: input.kind,
        source: input.source ?? null,
        payload: (input.payload ?? null) as never,
        idempotencyKey: key,
      },
    });
    // W6: an achieved or missed goal is a brain moment, keyed by this event's id (lib/brain/goal-brain.ts). A replay
    // (created:false) retries the write for the existing event: the key makes it a no-op when the row is there.
    if (input.kind === "achieved" || input.kind === "missed") {
      void import("@/lib/brain/goal-brain")
        .then((b) => b.afterGoalMoment({ goalEventId: res.row.id, goalId: input.goalId, kind: input.kind }))
        .catch((err) => log.warn("goal_brain_hook_failed", { goalId: input.goalId, err: err instanceof Error ? err.message : String(err) }));
    }
  } catch (err) {
    log.warn("emit_failed", {
      kind: input.kind,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Synchronous fire-and-forget — caller doesn't even hold the promise. */
export function emitGoalEventAsync(input: GoalEventInput): void {
  void emitGoalEvent(input);
}

// ─── Aggregate queries (used by PLAN-tab features) ──────────────

/**
 * Sum of progress_logged deltas in the last N days. Drives the
 * "loops this week" counter on goal cards: Nour's own progress, so the shop sync's values are excluded.
 */
export async function getProgressInWindow(
  goalId: string,
  windowDays: number = 7,
): Promise<{ totalDelta: number; events: number }> {
  try {
    const since = new Date(Date.now() - windowDays * 86400_000);
    const rows = await prisma.goalEvent.findMany({
      where: { goalId, kind: "progress_logged", createdAt: { gte: since }, ...OWN_PROGRESS_WHERE },
      select: { payload: true },
    });
    let total = 0;
    for (const r of rows) {
      const p = r.payload as { delta?: number } | null;
      if (typeof p?.delta === "number") total += p.delta;
    }
    return { totalDelta: total, events: rows.length };
  } catch {
    return { totalDelta: 0, events: 0 };
  }
}

/**
 * Returns the last 30 days as 30 buckets of progress-logged deltas
 * for sparkline rendering. Bucket index 0 = 30 days ago, 29 = today.
 */
export async function getProgressSparkline(
  goalId: string,
  days: number = 30,
): Promise<number[]> {
  try {
    const since = new Date(Date.now() - days * 86400_000);
    const rows = await prisma.goalEvent.findMany({
      where: { goalId, kind: "progress_logged", createdAt: { gte: since } },
      select: { payload: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const buckets: number[] = new Array(days).fill(0);
    const now = Date.now();
    for (const r of rows) {
      const ageDays = Math.floor((now - r.createdAt.getTime()) / 86400_000);
      const idx = days - 1 - ageDays;
      if (idx >= 0 && idx < days) {
        const p = r.payload as { delta?: number } | null;
        buckets[idx] += typeof p?.delta === "number" ? p.delta : 1;
      }
    }
    return buckets;
  } catch {
    return new Array(days).fill(0);
  }
}

/**
 * Returns the last `limit` events for a goal, newest first. Used by
 * the expand-to-deep-dive panel timeline.
 */
export async function listGoalEvents(
  goalId: string,
  limit: number = 30,
): Promise<
  Array<{
    id: string;
    kind: GoalEventKind;
    source: string | null;
    payload: Record<string, unknown> | null;
    createdAt: string;
  }>
> {
  try {
    const rows = await prisma.goalEvent.findMany({
      where: { goalId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, kind: true, source: true, payload: true, createdAt: true },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as GoalEventKind,
      source: r.source,
      payload: r.payload as Record<string, unknown> | null,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}
