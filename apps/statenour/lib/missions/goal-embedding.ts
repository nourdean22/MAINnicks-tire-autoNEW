/**
 * W8c · how an active goal is embedded for the mission goal suggestion (lib/missions/suggest-goal.ts). The nightly
 * conversation-mission-link cron writes these rows with its own embed path; the suggestion only reads them. No
 * server imports, so both sides share one text rule and one cap.
 */
export const GOAL_EMBED_SOURCE_TYPE = "life_goal";

/** Active goals read (and embedded) per pass; prod has 3 active goals. */
export const SUGGEST_GOAL_MAX_GOALS = 50;

/** A goal's embedding text: its title and its "why" (LifeGoal has no description field). */
export function goalEmbedText(goal: { title: string; why: string | null }): string {
  return [goal.title.trim(), goal.why?.trim()].filter(Boolean).join("\n");
}
