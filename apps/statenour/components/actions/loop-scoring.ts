/**
 * loop-scoring · the pure ranking logic behind the NOW stream.
 *
 * Extracted from `components/actions/loop-stream.tsx` on 2026-08-09, following
 * the same pattern that already moved `break-promise-modal.tsx` and
 * `loop-row-item.tsx` out of that file. This slice is the one that was worth
 * pulling for CORRECTNESS rather than size: it is entirely pure — no React, no
 * hooks, no DOM — and while it lived inside a `"use client"` component it could
 * not be unit-tested at all (statenour's vitest environment is `node`, and the
 * component pulls trpc, sonner and a dozen hooks in through its import graph).
 * The urgency ladder decides what the operator sees FIRST every day and had
 * zero direct test coverage.
 *
 * It also ends a documented duplication: `derive-mission-matrix.ts` carried the
 * comment "Weights mirror the EFFORT_RANK ladder in loop-stream.tsx" — mirrored
 * knowledge that had no mechanism keeping the two in step. EFFORT_RANK is
 * exported here so the mirror can become an import.
 *
 * Deliberately NOT a behavior change. Every constant, branch and number below
 * is byte-identical to what shipped; only its address changed.
 */
import { daysSince as ds, type Task, type LoopKind } from "@/components/actions/shared";

export type TaskSortKey =
  | "urgency"
  | "title-asc"
  | "title-desc"
  | "due-soonest"
  | "due-latest"
  | "created-newest"
  | "created-oldest"
  | "effort-shortest"
  | "effort-longest"
  // 2026-05-23 · task #20 · second grouping axis · sorts by status
  // rank (DOING → READY → INBOX → WAITING → DONE) AND inserts status-
  // section eyebrows the same way "urgency" inserts kind-section
  // eyebrows. Mutually exclusive — only one section axis at a time.
  | "by-status";

export const EFFORT_RANK: Record<string, number> = {
  M5: 0,
  M15: 1,
  M30: 2,
  H1: 3,
  H2PLUS: 4,
};

/**
 * 2026-05-23 · task #20 · status rank for "by-status" sort.
 * DOING (active) at the top, DONE/CANCELLED at the bottom — the
 * order an operator working the queue actually wants to see.
 * Unknown statuses sink to 99 so they don't crowd the top.
 */
export const STATUS_RANK: Record<string, number> = {
  DOING: 0,
  READY: 1,
  INBOX: 2,
  WAITING: 3,
  DONE: 4,
  CANCELLED: 5,
};

/** Lowercase human-readable label for the status section header. */
export const STATUS_HEADER_LABEL: Record<string, string> = {
  DOING: "doing · in flight",
  READY: "ready · next up",
  INBOX: "inbox · uncategorized",
  WAITING: "waiting · blocked",
  DONE: "done",
  CANCELLED: "cancelled",
};

export interface LoopRow {
  task: Task;
  kind: LoopKind;
  urgency: number;
  overdue: boolean;
  doneToday: boolean;
  daysUntilDeadline: number | null;
}

/**
 * Check if a DAILY loop has been completed already today.
 * Compares lastCompletedAt day-start to today day-start.
 */
export function isDoneTodayForDaily(task: Task): boolean {
  if (task.loopKind !== "DAILY") return false;
  if (!task.lastCompletedAt) return false;
  const last = new Date(task.lastCompletedAt);
  const now = new Date();
  return (
    last.getFullYear() === now.getFullYear() &&
    last.getMonth() === now.getMonth() &&
    last.getDate() === now.getDate()
  );
}

export function daysUntilDeadline(task: Task): number | null {
  if (!task.dueDate) return null;
  const due = new Date(task.dueDate);
  const now = new Date();
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dueStart.getTime() - nowStart.getTime()) / 86_400_000);
}

export function scoreUrgency(
  task: Task,
  goalPaceKind?: string | null,
): { urgency: number; overdue: boolean; doneToday: boolean; daysUntilDeadline: number | null } {
  const kind: LoopKind = (task.loopKind as LoopKind) || "ONCE";
  const daysUntil = daysUntilDeadline(task);
  const overdue = daysUntil !== null && daysUntil < 0;
  const doneToday = isDoneTodayForDaily(task);

  let urgency = 0;

  if (task.status === "DOING") urgency += 80;

  if (kind === "PROMISE") {
    if (overdue) urgency += 200;
    else if (daysUntil === 0) urgency += 70;
    else if (daysUntil !== null && daysUntil <= 3) urgency += 60;
    else if (daysUntil !== null && daysUntil <= 7) urgency += 30;
    else urgency += 25;
  } else if (kind === "DAILY") {
    if (doneToday) urgency += 5; // keep visible but at the bottom
    else urgency += 150;
  } else {
    // ONCE — canonical polarity: higher autoPriority = more urgent.
    const autoP = task.autoPriority ?? 50;
    if (task.stale || ds(task.createdAt) > 7) urgency += 100;
    else if (autoP >= 80) urgency += 100;
    else if (autoP >= 60) urgency += 50;
    else if (autoP >= 40) urgency += 20;
    else urgency += 10;
  }

  // Apr 27 · cross-tab smartness — tasks linked to a goal that's
  // behind pace get bumped up the NOW stream so the urgency
  // signal flows naturally from PLAN to NOW. Priority bump:
  //   missed   → +50 (deadline already blown)
  //   behind   → +30 (will miss without acceleration)
  //   needs    → +20 (zero progress yet, runway tight)
  //   ahead    → 0   (no need to push extra urgency)
  //   on-track → 0
  if (goalPaceKind === "missed") urgency += 50;
  else if (goalPaceKind === "behind") urgency += 30;
  else if (goalPaceKind === "needs") urgency += 20;

  return { urgency, overdue, doneToday, daysUntilDeadline: daysUntil };
}
