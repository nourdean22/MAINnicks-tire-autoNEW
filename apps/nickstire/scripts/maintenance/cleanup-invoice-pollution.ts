/**
 * Wave-97 invoice cleanup — surgical removal of polluted rows from
 * the `invoices` table, in three classes:
 *
 *   CLASS 1 — UUID-numbered dupes with a sibling real invoice
 *     Same customer + same amount + within 3 days, where the sibling
 *     has a numeric invoiceNumber. The UUID row is the leaked estimate
 *     write that happened BEFORE the customer accepted the work; the
 *     numeric row is the actual invoice. Delete the UUID row.
 *
 *   CLASS 2 — UUID-numbered orphans (no matching real invoice)
 *     These are estimates that never converted. Migrate them to
 *     alg_estimates (with synthetic external_id = "leaked-<uuid>")
 *     and then delete from invoices. Operator can recover-follow-up
 *     against these now that they're in the right table.
 *
 *   CLASS 3 — "Unknown $0" garbage
 *     Customer "Unknown" + totalAmount = 0. These are placeholder
 *     rows that should never have been ingested. Pure delete.
 *
 * SAFETY: dry-run by default. Pass --commit to mutate.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-invoice-pollution.ts          # dry run
 *   pnpm tsx scripts/cleanup-invoice-pollution.ts --commit # mutate
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const COMMIT = process.argv.includes("--commit");
const UUID_REGEX = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

interface UuidRow {
  id: number;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string | null;
  vehicleInfo: string | null;
  serviceDescription: string | null;
  totalAmount: number;
  invoiceDate: Date;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }

  console.log(`\n═══ Wave-97 invoice pollution cleanup ═══`);
  console.log(`Mode: ${COMMIT ? "🔴 COMMIT (will mutate DB)" : "🟢 DRY RUN (safe — pass --commit to mutate)"}\n`);

  const conn = await mysql.createConnection(url);
  try {
    // ─── CLASS 1: UUID + sibling real invoice → DELETE the UUID row ──
    console.log("\n─── CLASS 1: UUID rows with sibling real invoice ───");
    const [class1Raw] = await conn.execute(`
      SELECT u.id, u.invoiceNumber, u.customerName, u.totalAmount,
             u.invoiceDate, r.invoiceNumber AS real_num
      FROM invoices u
      JOIN invoices r
        ON r.customerName = u.customerName
        AND r.totalAmount = u.totalAmount
        AND ABS(DATEDIFF(u.invoiceDate, r.invoiceDate)) <= 3
        AND r.invoiceNumber NOT REGEXP '${UUID_REGEX}'
      WHERE u.invoiceNumber REGEXP '${UUID_REGEX}'
    `);
    const class1 = class1Raw as Array<UuidRow & { real_num: string }>;
    console.log(`Found ${class1.length} UUID rows with sibling real invoice`);
    for (const r of class1) {
      // pii sweep 2026-07-28 · first name only in script output
      const who1 = (r.customerName ?? "?").split(" ")[0];
      console.log(`  · DELETE invoices.id=${r.id} · ${who1} · $${(r.totalAmount / 100).toFixed(2)} · UUID=${r.invoiceNumber.slice(0, 8)}... has sibling Invoice#${r.real_num}`);
      if (COMMIT) {
        await conn.execute(`DELETE FROM invoices WHERE id = ?`, [r.id]);
      }
    }

    // ─── CLASS 2: orphan UUID rows → migrate to alg_estimates ──
    // Find UUID rows that DON'T have a sibling real invoice AND are not Unknown $0
    console.log("\n─── CLASS 2: orphan UUID rows (will migrate to alg_estimates) ───");
    const [class2Raw] = await conn.execute(`
      SELECT u.id, u.invoiceNumber, u.customerName, u.customerPhone,
             u.vehicleInfo, u.serviceDescription, u.totalAmount,
             u.invoiceDate
      FROM invoices u
      WHERE u.invoiceNumber REGEXP '${UUID_REGEX}'
        AND NOT (u.customerName = 'Unknown' AND u.totalAmount = 0)
        AND NOT EXISTS (
          SELECT 1 FROM invoices r
          WHERE r.customerName = u.customerName
            AND r.totalAmount = u.totalAmount
            AND ABS(DATEDIFF(u.invoiceDate, r.invoiceDate)) <= 3
            AND r.invoiceNumber NOT REGEXP '${UUID_REGEX}'
        )
    `);
    const class2 = class2Raw as UuidRow[];
    console.log(`Found ${class2.length} orphan UUID rows`);

    let migrated = 0;
    let alreadyInAlg = 0;
    for (const r of class2) {
      const synthExternalId = `leaked-${r.invoiceNumber}`;

      // Already migrated check (idempotent re-run safety)
      const [existingRaw] = await conn.execute(
        `SELECT id FROM alg_estimates WHERE external_id = ?`,
        [synthExternalId]
      );
      const existing = existingRaw as Array<{ id: number }>;

      if (existing.length > 0) {
        // both ids are already on the line, so the customer name was redundant
        // identification — dropped rather than masked.
        console.log(`  · SKIP migrate (already in alg_estimates as #${existing[0].id}): invoices.id=${r.id} · $${(r.totalAmount / 100).toFixed(2)}`);
        alreadyInAlg++;
        if (COMMIT) {
          await conn.execute(`DELETE FROM invoices WHERE id = ?`, [r.id]);
        }
        continue;
      }

      // pii sweep 2026-07-28 · first name only in script output
      const who2 = (r.customerName ?? "?").split(" ")[0];
      console.log(`  · MIGRATE invoices.id=${r.id} → alg_estimates · ${who2} · $${(r.totalAmount / 100).toFixed(2)} · ${r.invoiceDate.toISOString().slice(0, 10)}`);
      if (COMMIT) {
        await conn.execute(
          `INSERT INTO alg_estimates
            (external_id, customer_name, customer_phone, vehicle_info,
             service_description, estimated_amount, estimate_date,
             source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'wave-97-recovery', NOW(), NOW())`,
          [
            synthExternalId,
            r.customerName,
            r.customerPhone,
            r.vehicleInfo,
            r.serviceDescription,
            r.totalAmount,
            r.invoiceDate,
          ]
        );
        await conn.execute(`DELETE FROM invoices WHERE id = ?`, [r.id]);
        migrated++;
      }
    }

    // ─── CLASS 3: "Unknown $0" garbage → straight delete ──
    console.log("\n─── CLASS 3: Unknown $0 garbage rows ───");
    const [class3Raw] = await conn.execute(`
      SELECT id, invoiceNumber, invoiceDate
      FROM invoices
      WHERE customerName = 'Unknown' AND totalAmount = 0
    `);
    const class3 = class3Raw as Array<{ id: number; invoiceNumber: string; invoiceDate: Date }>;
    console.log(`Found ${class3.length} 'Unknown $0' garbage rows`);
    for (const r of class3) {
      console.log(`  · DELETE invoices.id=${r.id} · ${r.invoiceDate.toISOString().slice(0, 10)} · ${r.invoiceNumber.slice(0, 8)}...`);
      if (COMMIT) {
        await conn.execute(`DELETE FROM invoices WHERE id = ?`, [r.id]);
      }
    }

    // ─── Summary ──
    console.log(`\n─── SUMMARY ───`);
    console.log(`Class 1 (UUID + real sibling) — DELETE: ${class1.length}`);
    console.log(`Class 2 (orphan UUID) — MIGRATE to alg_estimates + DELETE from invoices: ${class2.length}`);
    console.log(`  Of which, already in alg_estimates: ${alreadyInAlg}`);
    console.log(`  Newly migrated: ${COMMIT ? migrated : "(dry run — nothing migrated)"}`);
    console.log(`Class 3 (Unknown $0 garbage) — DELETE: ${class3.length}`);
    const total = class1.length + class2.length + class3.length;
    console.log(`\nTotal rows to remove from invoices: ${total}`);

    // Estimated revenue correction
    const class1Revenue = class1.reduce((s, r) => s + r.totalAmount, 0) / 100;
    const class2Revenue = class2.reduce((s, r) => s + r.totalAmount, 0) / 100;
    console.log(`Revenue correction (these were inflating revenue):`);
    console.log(`  Class 1 (was double-counted): -$${class1Revenue.toFixed(2)}`);
    console.log(`  Class 2 (was estimates not invoices): -$${class2Revenue.toFixed(2)}`);
    console.log(`  Total revenue correction: -$${(class1Revenue + class2Revenue).toFixed(2)}`);

    if (!COMMIT) {
      console.log(`\n🟢 Dry run only. Re-run with --commit to mutate.`);
    } else {
      console.log(`\n✅ Cleanup committed.`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Crashed:", err);
  process.exit(1);
});
