/**
 * Wave-100 — initial backfill / on-demand refresh of customer_metrics.
 * Idempotent. Safe to run any time.
 *
 * Usage: pnpm tsx scripts/refresh-customer-metrics.ts
 */
import "dotenv/config";

async function main() {
  const { refreshCustomerMetrics } = await import("../../server/services/customerMetricsRefresh");
  const result = await refreshCustomerMetrics();
  console.log(`✅ Refreshed ${result.customersUpdated} customer_metrics rows in ${result.durationMs}ms`);
  process.exit(0);
}
main().catch((err) => { console.error("Crashed:", err); process.exit(1); });
