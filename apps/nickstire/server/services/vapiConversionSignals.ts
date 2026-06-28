/**
 * Pure conversion-signal helpers for the VAPI receptionist.
 *
 * Extracted so the SAME definitions are shared by the end-of-call webhook
 * (stamps vapi_call_logs.convertedToLead) and the daily eval cron
 * (reachedTool score input + the nightly digest band counts). Keeping them
 * in one tested module means the two paths can never drift apart — the bug
 * this fixes was exactly that drift (the digest compared an outcome CATEGORY
 * against SCORE-band labels, so it always reported 0).
 *
 * No DB, no imports — trivially unit-testable.
 */

/** Minimal shape of a call-state trail entry (see voice-call-state.ts). */
export interface CallStateLike {
  state: string;
}

/**
 * Did the call's tool-state trail show the AI complete a conversion action?
 *
 * A write/capture tool (bookSlot · tireInquiry · checkTireStock · escalate)
 * records state `tool_called`; sendConfirmationSms records `confirmed`. Either
 * means the agent moved the caller forward — the signal behind both
 * vapi_call_logs.convertedToLead and the eval's hard_conversion outcome.
 */
export function trailReachedTool(states: ReadonlyArray<CallStateLike>): boolean {
  return states.some((s) => s.state === "tool_called" || s.state === "confirmed");
}

export type ScoreBand = "wasted" | "info" | "converted" | "exemplary";

/**
 * Map a 0-100 eval score to its documented band (vapi_call_logs schema):
 *   <50 wasted · 50-69 info · 70-84 converted · 85+ exemplary.
 *
 * The digest counts "converted" as band converted+exemplary (>=70).
 */
export function scoreBand(score: number): ScoreBand {
  if (score < 50) return "wasted";
  if (score < 70) return "info";
  if (score < 85) return "converted";
  return "exemplary";
}

/**
 * Convenience: a score counts as a converted call (good outcome) at >=70.
 *
 * NOTE — two intentionally-distinct "conversion" notions live in this module,
 * and they are NOT expected to match per call (do not "reconcile" them):
 *   - trailReachedTool -> TOOL-ENGAGEMENT (a capture/confirm tool fired); this
 *                         is what vapi_call_logs.convertedToLead stores.
 *   - isConvertedScore -> SCORE-GRADE (eval score >= 70); this is what the
 *                         nightly digest's "converted" count uses.
 * A tool can fire on a low-scored call, and a high score can occur with no
 * tool — so a dashboard reading convertedToLead and the digest's "converted"
 * line legitimately report different numbers. They answer different questions.
 */
export function isConvertedScore(score: number): boolean {
  const b = scoreBand(score);
  return b === "converted" || b === "exemplary";
}
