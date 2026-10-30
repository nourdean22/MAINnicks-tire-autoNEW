/**
 * Brief sections that must never reach a lock-screen preview (2026-10-22).
 *
 * The morning-brief push body is a short slice of the brief text
 * (lib/inngest/functions/morning-brief.ts pushBodyFromBrief). The weekly
 * "What you're not seeing" section quotes private claim-vs-record gaps, so the
 * push body is cut at its header. A pure module, so the push path does not load
 * the section's database reads.
 */
export const NOT_SEEING_HEADER = "<b>What you're not seeing</b>";

/** The Monday Goals section (lib/services/goal-review-line.ts) names a goal; same rule (2026-10-30). */
export const GOALS_HEADER = "<b>Goals</b>";
