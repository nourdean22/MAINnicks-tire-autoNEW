import type { NourState } from "@/lib/state/nour-state";

/**
 * UI v3 W1a: the one word that replaced the state-colored aura around every mastery page.
 *
 * The aura said "something is off" with a tint nobody could read. This says which state, in words.
 * Sentence case, at most two words. The keys are the NourState union, so a new state does not compile
 * until it has a label.
 */
export const STATE_WORD: Record<NourState["currentState"], string> = {
  normal: "Steady",
  on_fire: "On fire",
  drift: "Drifting",
  scattered: "Scattered",
  low_energy: "Low energy",
};

export interface StateWord {
  text: string;
  /** "signal": a state worth a gold notch. "calm": nothing to flag. "unknown": the state was not read. */
  tone: "signal" | "calm" | "unknown";
}

/**
 * What the status line says, or null while the first load is in flight.
 *
 * NourStateProvider starts at "normal" and detectState returns "normal" when every feed failed (no
 * alerts, no commitments, a 0.5 habit rate). Showing "Steady" for either would put a failed or missing
 * read on screen as good news, so loading is blank and an unread health feed (systemStatus "unknown")
 * or a failed load says so.
 */
export function stateWord(s: Pick<NourState, "currentState" | "isLoading" | "error" | "systemStatus">): StateWord | null {
  if (s.isLoading) return null;
  if (s.error !== null || s.systemStatus === "unknown") return { text: "State unknown", tone: "unknown" };
  return { text: STATE_WORD[s.currentState], tone: s.currentState === "normal" ? "calm" : "signal" };
}
