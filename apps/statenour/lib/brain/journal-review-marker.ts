/**
 * The weekly review's journal rows (lib/services/weekly-review.ts) carry this entryType. They are his own words,
 * grounded by his own choice: the journal brain's sweeps must never re-ground or retype them (journal-brain.ts).
 */
export const REVIEW_ENTRY_TYPE = "weekly_review";

/** CONTROLS RULE: a review is due this many days after the last one (and at once when none exists). Named once. */
export const REVIEW_WINDOW_DAYS = 7;
