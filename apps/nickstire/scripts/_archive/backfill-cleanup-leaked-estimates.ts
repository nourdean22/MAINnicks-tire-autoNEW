/**
 * Wave-97 backfill — clean up estimates that were accidentally written
 * into the `invoices` table by the HTML-scrape fallback in
 * shopDriverMirror.ts.
 *
 * Background: parseInvoiceHtml in shopDriverMirror.ts used to extract
 * BOTH `Invoice# XXXX` and `Estimate# XXXX` tokens from the /recent
 * HTML page and route everything through upsertInvoices(). The fix in
 * wave-97 prevents future leakage. This script cleans up the historical
 * pollution.
 *
 * What it does:
 *   1. SELECT * FROM invoices WHERE invoiceNumber LIKE 'Estimate#%'
 *   2. For each one, check if a matching alg_estimates row exists by
 *      external_id. If yes — just delete the invoices row. If no —
 *      INSERT INTO alg_estimates with a synthetic external_id derived
 *      from the leaked invoiceNumber, then delete from invoices.
 *   3. Print a summary: rows examined / migrated / dry-deleted.
 *
 * IDEMPOTENT: safe to run multiple times. Re-running on a clean DB is
 * a no-op.
 *
 * SAFETY: defaults to DRY-RUN. Pass --commit to actually mutate. The
 * dry-run path prints exactly which rows it would touch so you can
 * eyeball the count first.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-cleanup-leaked-estimates.ts          # dry run
 *   pnpm tsx scripts/backfill-cleanup-leaked-estimates.ts --commit # actually mutate
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const COMMIT = process.argv.includes("--commit");

interface LeakedRow {
  id: number;
  invoiceNumber: string | null;
  customerName: string;
  customerPhone: string | null;
  vehicleInfo: string | null;
  serviceDescription: string | null;
  totalAmount: number;
  invoiceDate: Date;
  paymentStatus: string;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL missing in env");
    process.exit(1);
  }

  console.log(`\n═══ wave-97 estimate-leak cleanup ═══`);
  console.log(`Mode: ${COMMIT ? "🔴 COMMIT (will mutate DB)" : "🟢 DRY RUN (safe — pass --commit to mutate)"}\n`);

  const conn = await mysql.createConnection(url);

  try {
    // 1. Find all leaked rows in invoices
    const [leakedRowsRaw] = await conn.execute(
      `SELECT id, invoiceNumber, customerName, customerPhone,
              vehicleInfo, serviceDescription, totalAmount, invoiceDate,
              paymentStatus
       FROM invoices
       WHERE invoiceNumber LIKE 'Estimate#%'
       ORDER BY invoiceDate DESC`
    );
    const leakedRows = leakedRowsRaw as LeakedRow[];

    if (leakedRows.length === 0) {
      console.log("✅ No leaked estimate rows found in invoices table — nothing to clean up.");
      console.log("   (This is expected on a fresh DB, or after this script has already run.)\n");
      return;
    }

    console.log(`Found ${leakedRows.length} leaked estimate rows in invoices table:\n`);

    let migrated = 0;
    let alreadyInAlg = 0;
    let deleted = 0;
    let errors = 0;

    for (const row of leakedRows) {
      // Extract the estimate number from "Estimate# 1714" → "1714"
      const m = row.invoiceNumber?.match(/Estimate#\s*(\d+)/i);
      const estimateNumber = m ? m[1] : null;
      const synthExternalId = estimateNumber
        ? `html-scrape-${estimateNumber}`
        : `html-scrape-row-${row.id}`;

      // Check if already in alg_estimates (by synthetic id OR by phone+date+amount fuzzy match)
      const [existingByIdRaw] = await conn.execute(
        `SELECT id FROM alg_estimates WHERE external_id = ?`,
        [synthExternalId]
      );
      const existingById = existingByIdRaw as { id: number }[];

      let existingByFuzzy: { id: number }[] = [];
      if (existingById.length === 0 && row.customerPhone && estimateNumber) {
        const [fuzzyRaw] = await conn.execute(
          `SELECT id FROM alg_estimates
           WHERE customer_phone = ?
           AND ABS(estimated_amount - ?) < 100
           AND ABS(TIMESTAMPDIFF(DAY, estimate_date, ?)) <= 2
           LIMIT 1`,
          [row.customerPhone, row.totalAmount, row.invoiceDate]
        );
        existingByFuzzy = fuzzyRaw as { id: number }[];
      }

      const alreadyExists = existingById.length > 0 || existingByFuzzy.length > 0;
      const action = alreadyExists ? "DELETE-ONLY (already in alg_estimates)" : "MIGRATE+DELETE";

      console.log(`  · invoices.id=${row.id} · ${row.invoiceNumber} · ${row.customerName} · $${(row.totalAmount / 100).toFixed(2)} · ${row.invoiceDate.toISOString().slice(0, 10)} → ${action}`);

      if (!COMMIT) continue;

      try {
        if (!alreadyExists) {
          // Migrate to alg_estimates
          await conn.execute(
            `INSERT INTO alg_estimates
              (external_id, customer_name, customer_phone, vehicle_info,
               service_description, estimated_amount, estimate_date,
               source, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'html-scrape-recovery', NOW(), NOW())`,
            [
              synthExternalId,
              row.customerName,
              row.customerPhone,
              row.vehicleInfo,
              row.serviceDescription,
              row.totalAmount,
              row.invoiceDate,
            ]
          );
          migrated++;
        } else {
          alreadyInAlg++;
        }

        // Delete from invoices regardless
        await conn.execute(`DELETE FROM invoices WHERE id = ?`, [row.id]);
        deleted++;
      } catch (err) {
        console.error(`    ❌ Failed on row ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
        errors++;
      }
    }

    console.log(`\n─── Summary ───`);
    console.log(`Examined:           ${leakedRows.length}`);
    if (COMMIT) {
      console.log(`Migrated to alg_estimates:  ${migrated}`);
      console.log(`Already in alg_estimates:   ${alreadyInAlg}`);
      console.log(`Deleted from invoices:      ${deleted}`);
      if (errors > 0) console.log(`❌ Errors:                  ${errors}`);
      console.log(`\n✅ Cleanup complete.`);
    } else {
      console.log(`\n🟢 Dry run only. Re-run with --commit to actually mutate.`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Script crashed:", err);
  process.exit(1);
});
