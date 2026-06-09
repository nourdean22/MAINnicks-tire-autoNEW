/**
 * Task-completion reward — the small, HONEST signal shown when Nour completes a
 * task on /missions. Only reflects what the backend actually reported: real XP
 * from creditTaskStats (never invented), whether a goal-tagged task lifted its
 * goal, and the daily streak. Pure + client-safe (no server imports).
 *
 * Wire #2 of the post-audit wiring. See docs/project/ORGANIZATION-WIRING-AUDIT.md.
 */

export interface TaskReward {
  /** Real stat XP credited (the creditTaskStats return). 0 ⇒ nothing credited. */
  xp: number;
  /** The task was goal-tagged, so completing it logged goal progress. */
  goalLifted: boolean;
  /** Streak count after a DAILY completion (null/absent for one-shots). */
  streak?: number | null;
}

/**
 * Render a reward as a one-line toast, or null when there's nothing worth
 * showing (no XP, no goal, no streak ≥ 2) — so we never toast empty noise and
 * never claim credit the backend didn't report.
 */
export function formatReward(r: TaskReward | null | undefined): string | null {
  if (!r) return null;
  const parts: string[] = [];
  if (r.xp > 0) parts.push(`+${r.xp} XP`);
  if (r.goalLifted) parts.push("goal progress logged");
  if (typeof r.streak === "number" && r.streak >= 2) parts.push(`🔥 ${r.streak}-day streak`);
  if (parts.length === 0) return null;
  return `✓ ${parts.join(" · ")}`;
}
