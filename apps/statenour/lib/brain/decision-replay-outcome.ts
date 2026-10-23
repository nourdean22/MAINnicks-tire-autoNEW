/**
 * The outcome text scripts/brain-hygiene/close-overdue-replays.ts writes when it closes an overdue,
 * never-reviewed DecisionReplay without a review. No imports on purpose: the script (which must not load
 * Prisma before a connecting mode) and the reader (lib/services/decision-replays.ts, which hides these rows from
 * the "recent reviewed" list) both take it from here, so the two cannot drift.
 */
export const EXPIRED_OUTCOME = "not reviewed, expired";
