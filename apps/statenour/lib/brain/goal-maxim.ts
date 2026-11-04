/**
 * One maxim for a goal moment (job 2026-11-02-nour-os-interconnect W6).
 *
 * Pure: the pool comes in as data (MAXIM_POOL, his books), so the goal card (W5) and Nick's recall pick the
 * same line for the same goal on the same day. Never a new pool and never a model call: the state picks a tag
 * from the fixed maxim tag list, then pickMaximForDay keys the pick by day, goal and state.
 *
 * at_risk and check_in_due share "focus" on purpose: both say "look at this goal now, before it slips".
 */
import { pickMaximForDay, type Maxim, type MaximTag } from "@/lib/wisdom/maxims";
import type { GoalHealthState } from "@/lib/brain/goal-pace";
import { today } from "@/lib/utils/datetime";

export const GOAL_MOMENT_STATES = ["behind_pace", "off_track", "at_risk", "check_in_due", "achieved"] as const;
export type GoalMomentState = (typeof GOAL_MOMENT_STATES)[number];

export const GOAL_MOMENT_TAG: Readonly<Record<GoalMomentState, MaximTag>> = {
  off_track: "decisions",
  behind_pace: "timing",
  at_risk: "focus",
  check_in_due: "focus",
  achieved: "learning",
};

/** The longest maxim line a goal surface shows (the pool's longest is 99 chars, 2026-11-02). */
export const MAXIM_TEXT_MAX = 160;

export interface GoalMomentInput {
  id: string;
  status: string;
  /** From goalHealthFrom; null when the caller has no health read. "unknown" never earns a maxim. */
  health: GoalHealthState | null;
  /** A PaceVerdict (or anything with its kind); null when unscored or unread. */
  pace: { kind: string } | null;
}

export interface GoalMaxim {
  id: string;
  text: string;
  origin: string;
  state: GoalMomentState;
}

export function goalMomentState(g: Omit<GoalMomentInput, "id">): GoalMomentState | null {
  if (g.status === "achieved") return "achieved";
  if (g.status === "missed" || g.health === "off_track" || g.pace?.kind === "missed") return "off_track";
  // W8a (audit C10): with no check-in the pace is computed from a value nobody has updated, so "behind" is a
  // guess. The honest moment is "check in", before any pace state (a missed date above is still a fact).
  if (g.health === "no_check_in") return "check_in_due";
  if (g.pace?.kind === "behind") return "behind_pace";
  if (g.health === "at_risk") return "at_risk";
  return null;
}

export function maximForGoalMoment(goal: GoalMomentInput, pool: readonly Maxim[], day: string = today()): GoalMaxim | null {
  const state = goalMomentState(goal);
  if (!state) return null;
  const m = pickMaximForDay(pool, GOAL_MOMENT_TAG[state], `${day}:${goal.id}:${state}`);
  return m ? { id: m.id, text: m.text.slice(0, MAXIM_TEXT_MAX), origin: m.source, state } : null;
}
