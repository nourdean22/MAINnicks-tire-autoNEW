/**
 * Cron: Customer Segmentation — Weekly re-segmentation
 * Classifies every customer into a segment based on recency of last visit.
 * Segments: recent (0-90d), lapsed (91-365d), new (no visits yet), unknown (>365d or no data).
 */
import { createLogger } from "../../lib/logger";

const log = createLogger("cron:segmentation");

export async function processCustomerSegmentation(): Promise<{ recordsProcessed: number }> {
  // wave-182 (architecture decision #2 — single segment owner):
  // `customers.segment` is now written EXCLUSIVELY by enrichCustomerData()
  // (dataPipelines.ts, step 6), which runs inside the canonical enrichment
  // pipeline AFTER lastVisitDate is freshly recomputed, and uses a dirty-check
  // guard to avoid churn. This standalone cron was a redundant full-table sweep
  // registered THREE times (cron/index.ts + scheduler Tier 3 + Tier 4), firing
  // 10+×/day on possibly-stale lastVisitDate and racing the pipeline. It is now
  // a no-op so segment ownership is unambiguous. The function is kept exported
  // so the scheduler/job-registry wiring is undisturbed. Fully reversible —
  // restore the four UPDATE statements from git history to re-enable.
  log.info("Customer segmentation skipped — owned by enrichCustomerData() pipeline (step 6)");
  return { recordsProcessed: 0 };
}
