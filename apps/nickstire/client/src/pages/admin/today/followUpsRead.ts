/**
 * Today's read of the Pipeline follow-ups: the same input, order and card count as Sales Pipeline >
 * Today's follow-ups (OpportunitiesSection.tsx), so both screens share one react-query cache entry and
 * show the same rows. OpportunitiesSection.tsx keeps its own copies until a sibling PR lets it import
 * these; today-board-v2.test.tsx reads that file as text and fails if the two drift.
 */
import type { RouterOutputs } from "@/lib/trpc";

export type FollowUpRow = RouterOutputs["opportunityQueue"]["list"]["items"][number];

/** The server's live (non-terminal) states. */
const RELEVANT_STATES = ["new", "assigned", "attempted", "contacted", "scheduled", "walk_in_expected", "arrived", "no_response"] as const;

export const LIST_INPUT = { states: [...RELEVANT_STATES], limit: 500, order: "worklist" as const };

/** Follow-up rows Today shows; the Pipeline shows the same five before Show all. */
export const FOLLOW_UPS_ON_BOARD = 5;

export function followUpTypeLabel(sourceType: string): string {
  const words = sourceType.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Nobody has tried yet comes first; inside each group the newest row is on top. */
export function worklistOrder(a: FollowUpRow, b: FollowUpRow): number {
  const untouched = Number(a.attempts !== 0) - Number(b.attempts !== 0);
  return untouched || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}
