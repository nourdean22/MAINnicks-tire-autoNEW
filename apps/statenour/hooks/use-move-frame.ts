"use client";

/**
 * useMoveFrame · Phase 1 of /tasks v2.2 MOVE FRAME redesign · 2026-05-26
 *
 * The MoveFrame hero replaces "operator scans 1000-line list to figure
 * out what to do next" with a 3-card spread that picks for them:
 *
 *   NOW   = highest-urgency non-DAILY active task (the answer to "what now?")
 *   NEXT  = #2 most urgent of any kind (the answer to "what after?")
 *   DAILY = top DAILY habit not yet checked today (the streak anchor)
 *
 * The hook is a PURE FUNCTION over the existing Task[] the page already
 * loads — no new tRPC, no new server load, no schema change. Drop-in
 * additive over the current /tasks state.
 *
 * Selection logic ·
 *
 *   - Active tasks only (status not in {DONE, ARCHIVED}).
 *   - DAILY tasks excluded from NOW / NEXT — they're streak rows, not
 *     execution rows. NOW + NEXT are the operator's PROMISE/ONCE work.
 *     The DAILY card surfaces them in their own lane.
 *   - DAILY card hides when today's habit is already checked
 *     (lastCompletedAt within today's local-noon window). Reduces
 *     visual noise after the habit is logged.
 *   - Sort: `autoPriority` desc (higher = more urgent) · NULLs last. The scoring engine
 *     (lib/tasks/auto-priority) is the source of truth. We don't
 *     re-derive urgency here.
 *
 * Empty states are explicit (`isEmpty`) so the consumer can render a
 * "no tasks · capture one below" stub instead of three blank cards.
 *
 * v2.2 Phase 1B (deferred): wire 4 actions on NOW (Do/Defer/Done/Skip)
 * + auto-rotate animation when NOW transitions to DONE. Phase 1 ships
 * the read-only HUD only — the visible-impact win — and the action
 * surface lands surgically once mutation handlers are extracted.
 */

import { useMemo } from "react";
import type { Task } from "@/components/actions/shared";

export interface MoveFrameResult {
  /** Top non-DAILY task by urgency · the "do this right now" slot. */
  now: Task | null;
  /** #2 by urgency (any kind, excluding `now`) · the on-deck slot. */
  next: Task | null;
  /** Top DAILY habit not yet checked today · streak anchor. */
  daily: Task | null;
  /** True when no task qualifies for any of the 3 slots. */
  isEmpty: boolean;
}

/** Tasks in a state we never surface in the hero. */
const HIDDEN_STATUSES = new Set(["DONE", "ARCHIVED", "DELETED"]);

/** Returns local-noon-anchored YYYY-MM-DD for today. */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** True if `iso` falls on the same local calendar day as now. */
function isCheckedToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` ===
    todayKey()
  );
}

/** Sort descending by autoPriority · NULLs land at the bottom. */
function byUrgencyDesc(a: Task, b: Task): number {
  const pa = a.autoPriority ?? -Infinity;
  const pb = b.autoPriority ?? -Infinity;
  if (pa !== pb) return pb - pa;
  // Tiebreaker · most-recent updatedAt floats (recency = signal)
  const ua = a.updatedAt ? Date.parse(a.updatedAt) : 0;
  const ub = b.updatedAt ? Date.parse(b.updatedAt) : 0;
  return ub - ua;
}

export function useMoveFrame(tasks: Task[]): MoveFrameResult {
  return useMemo(() => {
    if (!tasks || tasks.length === 0) {
      return { now: null, next: null, daily: null, isEmpty: true };
    }

    const active = tasks.filter((t) => !HIDDEN_STATUSES.has(t.status));
    if (active.length === 0) {
      return { now: null, next: null, daily: null, isEmpty: true };
    }

    // DAILY pool · top-1 by streakCount (longest-running habit gets the
    // anchor slot). Skip habits already checked today — reduces noise
    // after the operator logs them.
    const dailyPool = active
      .filter((t) => t.loopKind === "DAILY" && !isCheckedToday(t.lastCompletedAt))
      .sort((a, b) => (b.streakCount ?? 0) - (a.streakCount ?? 0));
    const daily = dailyPool[0] ?? null;

    // NOW + NEXT pool · non-DAILY active tasks sorted by urgency.
    const movePool = active.filter((t) => t.loopKind !== "DAILY").sort(byUrgencyDesc);
    const now = movePool[0] ?? null;
    // NEXT skips `now` so we don't repeat the same row.
    const next = now ? (movePool.find((t) => t.id !== now.id) ?? null) : null;

    const isEmpty = now === null && next === null && daily === null;
    return { now, next, daily, isEmpty };
  }, [tasks]);
}
