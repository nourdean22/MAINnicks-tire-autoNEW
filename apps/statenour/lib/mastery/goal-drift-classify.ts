/**
 * Ambition Engine P2 · pure goal-drift classifier.
 *
 * No DB / no inngest imports — pure logic so it's unit-testable in isolation.
 * The cron that feeds it real data lives in
 * `src/inngest/functions/goal-drift-detector.ts`.
 *
 * Two proactive signals (caught BEFORE a goal goes fully stale — that 30d+
 * idle case is goal-pruner's job, not ours):
 *   · deadline-risk  (P1) — a deadline ≤14 days out, behind on progress, with
 *     no movement this week.
 *   · momentum-decay (P2) — the goal WAS active (≥2 events in the prior 4-week
 *     window) but has gone quiet this week, and isn't yet 30d-stale.
 */

export const RECENT_DAYS = 7; // "this week" — the quiet window
export const PRIOR_DAYS = 28; // look back 4 weeks for prior momentum
export const STALE_HANDOFF_DAYS = 30; // ≥30d idle is goal-pruner's job
export const DEADLINE_SOON_DAYS = 14;
export const DEADLINE_PROGRESS_FLOOR = 80; // "behind" if < this % near the deadline
export const MIN_PRIOR_EVENTS = 2; // "was active" threshold

export type DriftSignal = "momentum-decay" | "deadline-risk";

export interface DriftInput {
  /** events in the last RECENT_DAYS */
  recentEvents: number;
  /** events in the window (RECENT_DAYS, PRIOR_DAYS] */
  priorEvents: number;
  /** days since the most recent event / update */
  daysSinceActivity: number;
  /** goal progress, 0-100 */
  progress: number;
  /** days until the deadline (negative = past); null if no deadline */
  daysToDeadline: number | null;
}

export interface DriftVerdict {
  signal: DriftSignal;
  priority: "P1" | "P2";
}

/**
 * Classify a goal's drift state. Returns null when the goal is NOT drifting
 * (active this week, no deadline pressure, or already 30d-stale → pruner's).
 */
export function classifyDrift(i: DriftInput): DriftVerdict | null {
  // Deadline risk wins — a near deadline with no movement is the loudest.
  if (
    i.daysToDeadline !== null &&
    i.daysToDeadline >= 0 &&
    i.daysToDeadline <= DEADLINE_SOON_DAYS &&
    i.progress < DEADLINE_PROGRESS_FLOOR &&
    i.recentEvents === 0
  ) {
    return { signal: "deadline-risk", priority: "P1" };
  }

  // Momentum decay — was building, went quiet this week, not yet stale.
  if (
    i.priorEvents >= MIN_PRIOR_EVENTS &&
    i.recentEvents === 0 &&
    i.daysSinceActivity < STALE_HANDOFF_DAYS
  ) {
    return { signal: "momentum-decay", priority: "P2" };
  }

  return null;
}
