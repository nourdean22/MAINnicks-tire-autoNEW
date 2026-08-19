/**
 * Mastery scoring config · central tunables · 2026-06-01
 *
 * Single source of truth for the knobs that used to be scattered across
 * auto-learn.ts (the adaptive bump) and the quick-add classifier. Defaults
 * are the EXACT prior values, so centralizing changes no behavior — it just
 * gives the scoring + classification system one place to tune.
 *
 * Two distinct scoring surfaces share these multipliers:
 *   1. auto-learn's `MasteryScore.delta` — a 0-100 per-DOMAIN health score
 *      (uppercase Mission-domain bucket), read by the scoreboard + AI context.
 *   2. the character-sheet stat XP (`mastery_xp_event`, lowercase stat keys)
 *      credited by `creditTaskStats`. THIS is what the /stats levels read.
 * They live in different namespaces (domain bucket vs stat key) and never
 * collide, so each task completion feeds both without double-counting.
 */

// ─── Classifier confidence thresholds ───────────────────────────────
export const CONFIDENCE = {
  /** ≥ this → silent attach; below → park for the operator's approval chip. */
  silentAttach: 0.6,
  /** Floor to bother parking a suggestion — below this it's noise, drop it. */
  chipFloor: 0.3,
} as const;

// ─── Adaptive multiplier factors (moved from auto-learn.ts · same values)
/** Base score before multipliers · auto-learn's absolute-bump starting point. */
export const BASE_BUMP = 0.5;
/** Floor for auto-learn's absolute bump (trivial tasks still register). */
export const MIN_BUMP = 0.1;
/** Ceiling for auto-learn's absolute bump (no single task dominates a day). */
export const MAX_BUMP = 3.0;

/** Effort-band multipliers · longer focused work earns more. */
export const EFFORT_MULTIPLIER: Record<string, number> = {
  M5: 0.6,
  M15: 0.8,
  M30: 1.0,
  H1: 1.3,
  H2PLUS: 1.6,
};

/** Goal-linkage bonus · intentional work (tied to a goal) earns 1.5×. */
export const GOAL_LINKED_MULTIPLIER = 1.5;

/**
 * Outcome-rating multiplier (2026-08-19 · outcome-loop wave). Before
 * this, a FAILED completion bumped mastery exactly as much as an
 * OUTSTANDING one — the operator's own quality judgment (the strongest
 * signal in the completion) was write-only. Applied inside auto-learn's
 * adaptive bump; absent/null rating = 1.0 so older paths and quick
 * check-offs are byte-identical. FAILED still earns a sliver (the work
 * happened and MIN_BUMP floors it) — this scales growth, it does not
 * punish honesty about outcomes.
 */
export const RATING_MULTIPLIER: Record<string, number> = {
  OUTSTANDING: 1.25,
  SATISFACTORY: 1.0,
  SUBSTANDARD: 0.6,
  FAILED: 0.3,
};

/** Streak bonus · 7-day+ DAILY streak earns 2×, 3-day earns 1.3×. */
export function streakMultiplier(streakCount: number, loopKind: string): number {
  if (loopKind !== "DAILY") return 1.0;
  if (streakCount >= 7) return 2.0;
  if (streakCount >= 3) return 1.3;
  return 1.0;
}

// ─── Task → stat-XP multiplier (review #2: scales STAT XP, not currentValue)
/** Floor so a trivial task still credits a sliver of stat XP. */
export const MIN_TASK_STAT_XP = 0.1;

/** Fields the task-stat multiplier reads (a subset of a Task). */
export interface TaskScoringShape {
  roiScore?: number | null;
  effort?: string | null;
  streakCount?: number | null;
  loopKind?: string | null;
  hasGoalId?: boolean;
}

/**
 * Relative multiplier applied to `SIGNAL_XP.task` for one completion's stat
 * XP: roiWeight × effort × goal-linkage × streak. Unbounded-but-bounded by
 * its factors (~0.18 → ~4.8). NOT the same as auto-learn's absolute bump
 * (which adds BASE and clamps to [MIN_BUMP, MAX_BUMP] for the 0-100 score).
 * Pure + side-effect free so it unit-tests cleanly.
 */
export function taskStatMultiplier(task: TaskScoringShape): number {
  const roiWeight = Math.max(0.3, Math.min(1.0, (task.roiScore ?? 50) / 100));
  const effortMult = EFFORT_MULTIPLIER[task.effort ?? "M30"] ?? 1.0;
  const goalMult = task.hasGoalId ? GOAL_LINKED_MULTIPLIER : 1.0;
  const streakMult = streakMultiplier(task.streakCount ?? 0, task.loopKind ?? "ONCE");
  return roiWeight * effortMult * goalMult * streakMult;
}
