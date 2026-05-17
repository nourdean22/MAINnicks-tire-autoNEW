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
import { idempotencyRecipe, idempotentCreate } from "@/lib/db/idempotency";
import { createHash } from "node:crypto";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/goal-events");

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
  | "unlinked_project";

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
    await idempotentCreate({
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
 * "loops this week" counter on goal cards.
 */
export async function getProgressInWindow(
  goalId: string,
  windowDays: number = 7,
): Promise<{ totalDelta: number; events: number }> {
  try {
    const since = new Date(Date.now() - windowDays * 86400_000);
    const rows = await prisma.goalEvent.findMany({
      where: { goalId, kind: "progress_logged", createdAt: { gte: since } },
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
