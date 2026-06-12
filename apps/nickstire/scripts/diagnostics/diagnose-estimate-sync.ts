/**
 * Wave-97 verifier — fire the estimate mirror once against live ALG,
 * report what comes back. Confirms whether /recent HTML scraper extracts
 * estimates after the wave-97 fix.
 *
 * Usage: pnpm tsx scripts/diagnose-estimate-sync.ts
 *
 * Side effects: writes to alg_estimates if matches found. Idempotent
 * (upsert by external_id).
 */
import "dotenv/config";

async function main() {
  console.log("\n═══ Wave-97 Estimate Sync Verifier ═══\n");

  if (!process.env.AUTO_LABOR_USERNAME || !process.env.AUTO_LABOR_PASSWORD) {
    console.error("AUTO_LABOR_USERNAME / AUTO_LABOR_PASSWORD missing in .env");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL missing in .env");
    process.exit(1);
  }

  console.log(`Calling runEstimateMirror() against secure.autolaborexperts.com...`);
  console.log(`This will: auth → probe 15 JSON endpoints → fall through to HTML scrape (incl. /recent — wave-97 add)\n`);

  const start = Date.now();
  const { runEstimateMirror } = await import("../../server/services/shopDriverEstimateSync");
  const result = await runEstimateMirror();
  const elapsed = Date.now() - start;

  console.log(`\n─── Result ───`);
  console.log(`Records processed: ${result.recordsProcessed}`);
  console.log(`Details: ${result.details}`);
  console.log(`Elapsed: ${elapsed}ms\n`);

  // Re-query the alg_estimates table
  const mysql = (await import("mysql2/promise")).default;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [totalRow] = await conn.execute(`SELECT COUNT(*) as c FROM alg_estimates`);
    console.log(`alg_estimates total rows: ${(totalRow as { c: number }[])[0].c}`);

    const [recent] = await conn.execute(
      `SELECT external_id, customer_name, customer_phone, vehicle_info,
              estimated_amount, estimate_date, source
       FROM alg_estimates
       ORDER BY created_at DESC
       LIMIT 10`
    );
    console.log("\nLast 10 estimates ingested:");
    console.table(recent);
  } finally {
    await conn.end();
  }

  console.log("\n✅ Verifier complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Crashed:", err);
  process.exit(1);
});
