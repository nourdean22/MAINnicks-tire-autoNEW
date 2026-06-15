/**
 * Post-dedup recompute — runs the CANONICAL enrich + refreshCustomerMetrics
 * (exactly what the admin "Sync Data" / "Recompute" buttons call) so the 20
 * merged survivors + the 18 newly-linked-invoice customers get authoritative
 * totalSpent/totalVisits/segment/metrics. Idempotent.
 * Run: railway run -s MAINnicks-tire-auto pnpm exec tsx scripts/recompute-customers.ts
 */
async function main() {
  console.log("Running enrichCustomerData() (canonical, same as admin Sync Data)...");
  const { enrichCustomerData } = await import("../../server/services/dataPipelines");
  const e = await enrichCustomerData();
  console.log("enrich:", JSON.stringify(e));

  console.log("Running refreshCustomerMetrics() (canonical, same as admin Recompute)...");
  const { refreshCustomerMetrics } = await import("../../server/services/customerMetricsRefresh");
  const m = await refreshCustomerMetrics();
  console.log("metrics:", JSON.stringify(m));

  console.log("Recompute complete.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
