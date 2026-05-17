/**
 * Wave-101 — auto-create customer rows for declined ALG estimates whose
 * phone doesn't match any existing customer. Surfaces them in the
 * customer 360 admin so operator can call/SMS for recovery.
 *
 * Strategy:
 *   - SELECT all unmatched estimates with a 10+ digit phone
 *   - For each, check if last-10-digit fuzzy match finds a customer
 *   - If no match: INSERT a new customer row with name+phone+vehicleInfo
 *     parsed from the estimate
 *   - Customer source: "alg-estimate-recovery"
 *
 * Then re-run customerMetricsRefresh to link the new customers to their
 * estimates.
 *
 * SAFETY: dry-run by default. --commit to mutate.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const COMMIT = process.argv.includes("--commit");

interface OrphanEstimate {
  id: number;
  external_id: string;
  customer_name: string;
  customer_phone: string;
  vehicle_info: string | null;
  estimated_amount: number;
}

/**
 * Parse "LASTNAME, FIRSTNAME" or "Firstname Lastname" into parts.
 * ALG often returns the comma format; we normalize to first/last.
 */
function parseName(raw: string): { firstName: string; lastName: string } {
  const cleaned = raw.trim();
  if (cleaned.includes(",")) {
    const [last, first] = cleaned.split(",").map(s => s.trim());
    return { firstName: first || "", lastName: last || "" };
  }
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Parse vehicle_info ("2010 FORD * EDGE AWD") into year/make/model.
 */
function parseVehicle(raw: string | null): { year: string | null; make: string | null; model: string | null } {
  if (!raw) return { year: null, make: null, model: null };
  const m = raw.match(/^(\d{4})\s+([A-Za-z]+)(?:\s+\*?\s*(.*))?$/);
  if (!m) return { year: null, make: null, model: null };
  return { year: m[1], make: m[2], model: (m[3] || "").replace(/^\*\s*/, "").trim() || null };
}

function normalizePhone10(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return null;
}

async function main() {
  console.log(`\n═══ Wave-101 customer auto-create from orphan estimates ═══`);
  console.log(`Mode: ${COMMIT ? "🔴 COMMIT" : "🟢 DRY RUN (--commit to mutate)"}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    // Find unmatched estimates without a customer match
    const [orphansRaw] = await conn.execute(`
      SELECT e.id, e.external_id, e.customer_name, e.customer_phone,
             e.vehicle_info, e.estimated_amount
      FROM alg_estimates e
      WHERE e.matched_invoice_id IS NULL
        AND e.customer_phone IS NOT NULL
        AND CHAR_LENGTH(REGEXP_REPLACE(e.customer_phone, '[^0-9]', '')) >= 10
        AND NOT EXISTS (
          SELECT 1 FROM customers c
          WHERE RIGHT(REGEXP_REPLACE(c.phone, '[^0-9]', ''), 10) =
                RIGHT(REGEXP_REPLACE(e.customer_phone, '[^0-9]', ''), 10)
        )
      ORDER BY e.estimated_amount DESC
    `);
    const orphans = orphansRaw as OrphanEstimate[];
    console.log(`Found ${orphans.length} orphan estimates needing customer rows.\n`);

    // Group by phone — multiple estimates for same orphan customer = one new customer row
    const byPhone: Record<string, OrphanEstimate[]> = {};
    for (const o of orphans) {
      const phone10 = normalizePhone10(o.customer_phone);
      if (!phone10) continue;
      if (!byPhone[phone10]) byPhone[phone10] = [];
      byPhone[phone10].push(o);
    }
    console.log(`Unique phone numbers to create as customers: ${Object.keys(byPhone).length}\n`);

    let created = 0;
    let skipped = 0;
    for (const [phone10, ests] of Object.entries(byPhone)) {
      // Use the largest-amount estimate for the canonical customer record
      const canonical = ests.sort((a, b) => b.estimated_amount - a.estimated_amount)[0];
      const { firstName, lastName } = parseName(canonical.customer_name);
      const { year, make, model } = parseVehicle(canonical.vehicle_info);
      const totalDeclined = ests.reduce((s, e) => s + e.estimated_amount, 0);

      console.log(`  · ${COMMIT ? "CREATE" : "WOULD CREATE"} customer: ${firstName} ${lastName} · phone=${phone10} · ${ests.length} declined estimate${ests.length === 1 ? "" : "s"} · $${(totalDeclined / 100).toFixed(0)}`);

      if (COMMIT) {
        try {
          await conn.execute(
            `INSERT INTO customers
              (firstName, lastName, phone, customerType, totalVisits, totalSpent,
               vehicleYear, vehicleMake, vehicleModel,
               segment, smsCampaignSent, notes,
               createdAt, updatedAt)
             VALUES (?, ?, ?, 'individual', 0, 0, ?, ?, ?, 'unknown', 0, ?, NOW(), NOW())`,
            [
              firstName || "Unknown",
              lastName || null,
              phone10,
              year, make, model,
              `Auto-created from ALG estimate recovery (wave-101). ${ests.length} declined estimate(s) totaling $${(totalDeclined / 100).toFixed(0)}.`,
            ]
          );
          created++;
        } catch (err) {
          console.error(`    ❌ Failed: ${err instanceof Error ? err.message : String(err)}`);
          skipped++;
        }
      } else {
        created++;
      }
    }

    console.log(`\n─── SUMMARY ───`);
    console.log(`Orphan estimates:        ${orphans.length}`);
    console.log(`Unique phones:           ${Object.keys(byPhone).length}`);
    console.log(`Customers ${COMMIT ? "created" : "would create"}: ${created}`);
    if (skipped > 0) console.log(`Failed (errors):         ${skipped}`);
    if (!COMMIT) console.log(`\n🟢 Dry run only. Re-run with --commit to mutate.`);
    else console.log(`\n✅ Done. Run scripts/refresh-customer-metrics.ts to link them.`);
  } finally { await conn.end(); }
}

main().catch(err => { console.error("Crashed:", err); process.exit(1); });
