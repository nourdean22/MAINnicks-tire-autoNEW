/**
 * Cron: Review Request Trigger
 * Sends review request SMS 3 days after service completion.
 */
import { createLogger } from "../../lib/logger";
const log = createLogger("cron:reviews");

export async function processReviewRequests(): Promise<{ recordsProcessed: number }> {
  try {
    const { isEnabled } = await import("../../services/featureFlags");
    if (!(await isEnabled("sms_review_requests"))) return { recordsProcessed: 0 };
    const { processReviewRequestQueue } = await import("../../routers/reviewRequests");
    const result = await processReviewRequestQueue();
    return { recordsProcessed: typeof result === "number" ? result : 0 };
  } catch (err) {
    log.error("Review request processing failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0 };
  }
}
