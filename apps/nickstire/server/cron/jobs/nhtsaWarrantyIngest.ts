/**
 * Cron: NHTSA manufacturer warranty extensions ingest (ADR-0021 §6, Q-50 phase 2a).
 *
 * Daily tier (09:30 ET). Off until the operator applies migration 0138 and arms
 * `nhtsa_warranty_ingest`. A skip says why in `details`; any failure throws, so
 * the scheduler files a failed run, never a quiet empty success.
 *
 * Freshness for phase 2b must come from the stored state's `lastSuccessAt`,
 * NOT from the latest "completed" cron_log row: a flag-off or migration-missing
 * skip is also logged "completed".
 */
export async function processNhtsaWarrantyIngest(): Promise<{ recordsProcessed: number; details: string }> {
  const { runNhtsaWarrantyIngest, describeOutcome } = await import("../../services/nhtsaWarrantyIngest");
  const outcome = await runNhtsaWarrantyIngest();
  return {
    recordsProcessed: outcome.status === "completed" ? outcome.commsKept : 0,
    details: describeOutcome(outcome),
  };
}
