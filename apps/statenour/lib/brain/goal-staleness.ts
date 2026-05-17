/**
 * Goal Staleness — pure detector for the "is this goal a zombie?" question.
 *
 * Apr 27 · The PLAN tab was rendering goals that had been sitting at 0%
 * with zero linked tasks for months. Nour pointed at them and called
 * them out: "those r old n stale." This module classifies a goal's
 * decay state so the UI can:
 *   · collapse stale goals into a "show N stale" expander in the
 *     LinkGoalPicker dropdown
 *   · paint a "stale Nd · archive?" chip on the main goal card
 *   · surface them at the bottom of the order, not the top
 *
 * Pure — no DB, no React, no fetch.
 *
 * Definition: a goal is STALE when it has...
 *   · 0% progress
 *   · 0 linked tasks (or only completed/abandoned ones)
 *   · age >= 30 days
 *
 * A goal is DECAYING when it has...
 *   · some progress (or linked tasks) but no movement in 30 days
 *
 * Otherwise: ALIVE.
 *
 * Caller decides what to do with each verdict — this module just
 * returns the classification + a short explanation string.
 */

export type StalenessVerdict =
  | { kind: "alive" }
  | { kind: "decaying"; reason: string; ageDays: number }
  | { kind: "stale"; reason: string; ageDays: number };

interface StalenessInput {
  /** ISO string from the DB. */
  createdAt: string;
  /** ISO string. May be the same as createdAt for fresh goals. */
  updatedAt: string;
  progress: number;            // 0-100
  currentValue: number;
  status: string;              // active, achieved, paused, etc
  linkedActiveCount?: number;  // open tasks linked to this goal
  linkedDoneCount?: number;    // completed tasks linked
  loopsThisWeek?: number;      // recent completion velocity
  /** Most recent ISO string a related event happened — typically
   *  the freshest of: updatedAt, last GoalEvent, last linked task
   *  touch. The caller computes this; we just consume it. */
  lastTouchISO?: string | null;
}

const DAY_MS = 86_400_000;

export function classifyStaleness(g: StalenessInput): StalenessVerdict {
  // Goals not in active status aren't classified — paused/achieved/
  // missed don't need a staleness verdict.
  if (g.status !== "active") return { kind: "alive" };

  const now = Date.now();
  const ageMs = now - new Date(g.createdAt).getTime();
  const ageDays = Math.max(0, Math.round(ageMs / DAY_MS));

  // Touch age: how long since SOMETHING happened on this goal.
  // Caller can pass an explicit lastTouchISO; otherwise fall back to
  // updatedAt (the row's own clock, which moves on any field edit).
  const touchISO = g.lastTouchISO ?? g.updatedAt;
  const touchAgeMs = now - new Date(touchISO).getTime();
  const touchAgeDays = Math.max(0, Math.round(touchAgeMs / DAY_MS));

  const noProgress = g.progress === 0 && g.currentValue === 0;
  const totalLinked = (g.linkedActiveCount ?? 0) + (g.linkedDoneCount ?? 0);
  const noLinkedActivity = totalLinked === 0;
  const noWeeklyLoops = (g.loopsThisWeek ?? 0) === 0;

  // STALE — total zombie. No progress, no linked tasks, old enough
  // that "I just made it" doesn't apply.
  if (noProgress && noLinkedActivity && ageDays >= 30) {
    return {
      kind: "stale",
      reason: `${ageDays}d old · 0% · no linked tasks ever`,
      ageDays,
    };
  }

  // DECAYING — has SOMETHING (linked tasks or some progress) but
  // hasn't moved recently. The "I started but it died" state.
  if (touchAgeDays >= 30 && noWeeklyLoops) {
    if (noProgress && totalLinked > 0) {
      return {
        kind: "decaying",
        reason: `${touchAgeDays}d untouched · linked but no progress`,
        ageDays: touchAgeDays,
      };
    }
    if (g.progress > 0 && g.progress < 100) {
      return {
        kind: "decaying",
        reason: `${touchAgeDays}d untouched · ${g.progress}% but stalling`,
        ageDays: touchAgeDays,
      };
    }
  }

  return { kind: "alive" };
}

/**
 * Sort comparator for goal lists — alive first, then decaying, then
 * stale at the bottom. Within each bucket, recent first.
 */
export function compareByStaleness<G extends StalenessInput>(a: G, b: G): number {
  const av = classifyStaleness(a);
  const bv = classifyStaleness(b);
  const order: Record<StalenessVerdict["kind"], number> = {
    alive: 0,
    decaying: 1,
    stale: 2,
  };
  if (order[av.kind] !== order[bv.kind]) return order[av.kind] - order[bv.kind];
  // tie: most-recently-touched first
  const at = new Date(a.lastTouchISO ?? a.updatedAt).getTime();
  const bt = new Date(b.lastTouchISO ?? b.updatedAt).getTime();
  return bt - at;
}
