/**
 * Task-completion reward — the small, HONEST signal shown when Nour completes a
 * task on /missions. Only reflects what the backend actually reported: real XP
 * from creditTaskStats (never invented, never a stat-COUNT mislabelled as XP),
 * whether a goal-tagged task lifted its goal, and the daily streak. Pure +
 * client-safe (no server imports).
 *
 * Wire #2 of the post-audit wiring; xp-honesty fix 2026-06-09 (the field was a
 * single `xp: number` that producers filled with creditTaskStats' stat-COUNT,
 * so the toast rendered "+2 XP" for 2 stats worth e.g. 3.0 XP). Now the reward
 * carries the REAL xp (`xpCredited`) and, as a fallback, the count
 * (`statsCredited`) — and formatReward can ONLY print "+N XP" from real XP.
 * See docs/project/ORGANIZATION-WIRING-AUDIT.md + docs/RECONCILIATION.md.
 */

export interface LevelUpPayload {
  newLevel: number;
  tierName: string;
  tierEmoji: string;
}

export interface TaskReward {
  /**
   * Real total stat XP credited (creditTaskStats().xpCredited). `null` ⇒ the
   * caller doesn't know the real XP (use statsCredited instead — never fake it).
   * 0 ⇒ nothing was newly credited.
   */
  xpCredited: number | null;
  /** Stats newly credited — the honest fallback shown when real XP is unknown. */
  statsCredited?: number;
  /** The task was goal-tagged, so completing it logged goal progress. */
  goalLifted: boolean;
  /** Streak count after a DAILY completion (null/absent for one-shots). */
  streak?: number | null;
  /** Populated when the XP credit pushed the operator to a new level. */
  levelUp?: LevelUpPayload | null;
}

/** Integers print plainly; fractional XP (stat weights can be e.g. 1.4) to 1dp. */
function fmtXp(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

/**
 * Render a reward as a one-line toast, or null when there's nothing worth
 * showing — so we never toast empty noise and never claim credit the backend
 * didn't report. "+N XP" is printed ONLY from a real `xpCredited`; when only a
 * stat count is known we say "N stats credited" (never "+N XP").
 */
export function formatReward(r: TaskReward | null | undefined): string | null {
  if (!r) return null;
  const parts: string[] = [];
  if (typeof r.xpCredited === "number" && r.xpCredited > 0) {
    parts.push(`+${fmtXp(r.xpCredited)} XP`);
  } else if (typeof r.statsCredited === "number" && r.statsCredited > 0) {
    parts.push(`${r.statsCredited} stat${r.statsCredited === 1 ? "" : "s"} credited`);
  }
  if (r.goalLifted) parts.push("goal progress logged");
  if (typeof r.streak === "number" && r.streak >= 2) parts.push(`🔥 ${r.streak}-day streak`);
  if (r.levelUp) parts.push(`${r.levelUp.tierEmoji} Level ${r.levelUp.newLevel}!`);
  if (parts.length === 0) return null;
  return `✓ ${parts.join(" · ")}`;
}
