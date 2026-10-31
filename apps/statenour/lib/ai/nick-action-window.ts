/**
 * How far back the Nick action executor looks: the 09:00Z nick-action-execute backstop reads
 * approved rows created in this window (lib/ai/nick-action-batch.ts), and the app refuses to
 * approve older ones (lib/automation/approval-queue.ts). One constant, so the two cannot drift.
 * Its own file so the approval queue does not load the executor just to read a number.
 */
export const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
