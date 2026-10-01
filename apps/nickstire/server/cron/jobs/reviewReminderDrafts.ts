/**
 * Cron: Q-39 review reminder DRAFTS (services/reviewReminder.ts).
 *
 * Writes drafts for the Human Review Queue; never sends. Off until the operator
 * arms both `contact_holdouts_enabled` and `review_reminder_drafts`. A failure
 * throws, so both runners file it as a failed run, never a quiet empty one.
 */
export async function processReviewReminderDrafts(): Promise<{ recordsProcessed: number; details: string }> {
  const { draftReviewReminders } = await import("../../services/reviewReminder");
  const r = await draftReviewReminders();
  return {
    recordsProcessed: r.drafted,
    details: r.reason ?? `drafted ${r.drafted}, holdout controls ${r.heldOut}, skipped ${r.skipped}`,
  };
}
