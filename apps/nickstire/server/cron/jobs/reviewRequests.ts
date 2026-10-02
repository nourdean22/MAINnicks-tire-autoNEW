/**
 * Cron: Review Request Trigger
 * Sends review request SMS 3 days after service completion.
 */
import { createLogger } from "../../lib/logger";
const log = createLogger("cron:reviews");

export async function processReviewRequests(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { isEnabled } = await import("../../services/featureFlags");
    if (!(await isEnabled("sms_review_requests"))) return { recordsProcessed: 0, details: "flag sms_review_requests off" };
    // Paid ALG invoices -> pending review_requests rows (one per invoice, cooldown per phone).
    // Before 2026-10-02 only a website booking marked completed could create a row, so
    // walk-in work never got one. Inert (with a reason) until migration 0139 is applied.
    const { createInvoiceReviewRequests } = await import("../../services/invoiceReviewRequests");
    const fromInvoices = await createInvoiceReviewRequests();
    const createdNote = fromInvoices.reason
      ? `invoice rows: ${fromInvoices.reason}`
      : `invoice rows created ${fromInvoices.created} of ${fromInvoices.candidates} (cooldown ${fromInvoices.onCooldown}, dup ${fromInvoices.duplicate})`;
    const { processReviewRequestQueue } = await import("../../routers/reviewRequests");
    const result = await processReviewRequestQueue();
    // processReviewRequestQueue has ALWAYS returned an object — every one of
    // its five exits is a { processed, sent, failed } literal, and it has never
    // returned a number. So the old `typeof result === "number" ? result : 0`
    // was never true, and this job logged recordsProcessed: 0 into cron_log for
    // every run it has ever made, including runs that sent real SMS. The count
    // was not low; it was not a count. `details` carries the reason a run
    // declined so a legitimate zero (cap reached, quiet hours, gateway offline)
    // is legible as a decision rather than as nothing happening.
    const sendNote = "reason" in result && result.reason
      ? String(result.reason)
      : `sent ${result.sent}, queued ${"queued" in result ? result.queued : 0}, holdout controls ${"heldOut" in result ? result.heldOut : 0}, failed ${result.failed}`;
    return {
      recordsProcessed: result.processed + fromInvoices.created,
      details: `${createdNote} | ${sendNote}`,
    };
  } catch (err) {
    // ROS-083 · this catch used to swallow and return { recordsProcessed: 0 },
    // which both cron runners record as a COMPLETED run — a failure filed as a
    // success, on the job that texts customers asking for Google reviews. Both
    // runners already log status "failed" with the error message when a handler
    // throws (cron/index.ts:226, cron/scheduler.ts:424), so re-throwing is what
    // makes the outage visible in the admin cron table and to the failure
    // observer. The log.error stays for the local trace.
    log.error("Review request processing failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
