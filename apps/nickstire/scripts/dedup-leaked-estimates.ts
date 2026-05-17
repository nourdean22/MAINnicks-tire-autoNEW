/**
 * Wave-101 — dedup `leaked-<uuid>` estimates against real numeric ones.
 *
 * Wave-97 migrated UUID-numbered invoice pollution into alg_estimates
 * with synthetic external_id "leaked-<uuid>". When the real ALG estimate
 * came in via wave-98 historical backfill (numeric external_id), we
 * ended up with TWO rows for the same job:
 *   - "leaked-731429ba-..." — phone "2163109485" (no +1)
 *   - "1691" — phone "+12163109485"
 *   - Same customer · same amount · same date
 *
 * Strategy: for each leaked-* estimate, find its real-numeric sibling
 * (same last-10-digit phone + amount within 1% + date within 2 days).
 * If found:
 *   - Keep the real one (it has vehicle info + proper external_id)
 *   - Delete the leaked-*
 *   - Preserve any matched_invoice_id from either side
 *
 * SAFETY: dry-run by default. --commit to mutate.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const COMMIT = process.argv.includes("--commit");

interface LeakedRow {
  id: number;
  external_id: string;
  customer_name: string;
  customer_phone: string | null;
  estimated_amount: number;
  estimate_date: Date;
  matched_invoice_id: number | null;
  vehicle_info: string | null;
  service_description: string | null;
}

async function main() {
  console.log(`\n═══ Wave-101 leaked estimate dedup ═══`);
  console.log(`Mode: ${COMMIT ? "🔴 COMMIT" : "🟢 DRY RUN (--commit to mutate)"}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [leakedRaw] = await conn.execute(`
      SELECT id, external_id, customer_name, customer_phone, estimated_amount,
             estimate_date, matched_invoice_id, vehicle_info, service_description
      FROM alg_estimates
      WHERE external_id LIKE 'leaked-%'
      ORDER BY estimated_amount DESC
    `);
    const leaked = leakedRaw as LeakedRow[];
    console.log(`Found ${leaked.length} leaked-* estimates to check.\n`);

    let merged = 0;
    let kept = 0;
    let preservedMatch = 0;

    for (const l of leaked) {
      const phoneDigits = (l.customer_phone || "").replace(/\D/g, "");
      const phoneLast10 = phoneDigits.slice(-10);
      if (!phoneLast10 || phoneLast10.length < 10) {
        console.log(`  · KEEP leaked id=${l.id} (no phone): ${l.customer_name} · $${(l.estimated_amount / 100).toFixed(2)}`);
        kept++;
        continue;
      }

      // Find real-numeric sibling: same last-10 phone + amount within 1% + date ±2 days
      const amountTolerance = Math.max(100, l.estimated_amount * 0.01); // 1% or $1
      const [siblingRaw] = await conn.execute(
        `SELECT id, external_id, vehicle_info, service_description, matched_invoice_id
         FROM alg_estimates
         WHERE id != ?
           AND external_id NOT LIKE 'leaked-%'
           AND RIGHT(REGEXP_REPLACE(customer_phone, '[^0-9]', ''), 10) = ?
           AND ABS(estimated_amount - ?) < ?
           AND ABS(TIMESTAMPDIFF(DAY, estimate_date, ?)) <= 2
         LIMIT 1`,
        [l.id, phoneLast10, l.estimated_amount, amountTolerance, l.estimate_date]
      );
      const sibling = (siblingRaw as Array<{ id: number; external_id: string; vehicle_info: string | null; service_description: string | null; matched_invoice_id: number | null }>)[0];

      if (!sibling) {
        console.log(`  · KEEP leaked id=${l.id} (no sibling): ${l.customer_name} · $${(l.estimated_amount / 100).toFixed(2)}`);
        kept++;
        continue;
      }

      console.log(`  · MERGE leaked id=${l.id} → ${sibling.external_id} (id=${sibling.id}) · ${l.customer_name} · $${(l.estimated_amount / 100).toFixed(2)}`);

      if (COMMIT) {
        // Preserve matched_invoice_id if leaked has one but sibling doesn't
        if (l.matched_invoice_id && !sibling.matched_invoice_id) {
          await conn.execute(
            `UPDATE alg_estimates SET matched_invoice_id = ?, matched_at = NOW() WHERE id = ?`,
            [l.matched_invoice_id, sibling.id]
          );
          preservedMatch++;
        }
        // Backfill vehicle/service from leaked if sibling missing
        const updates: string[] = [];
        const params: unknown[] = [];
        if (l.vehicle_info && !sibling.vehicle_info) {
          updates.push("vehicle_info = ?");
          params.push(l.vehicle_info);
        }
        if (l.service_description && !sibling.service_description) {
          updates.push("service_description = ?");
          params.push(l.service_description);
        }
        if (updates.length > 0) {
          params.push(sibling.id);
          await conn.execute(`UPDATE alg_estimates SET ${updates.join(", ")} WHERE id = ?`, params);
        }
        // Delete the leaked one
        await conn.execute(`DELETE FROM alg_estimates WHERE id = ?`, [l.id]);
        merged++;
      }
    }

    console.log(`\n─── SUMMARY ───`);
    console.log(`Leaked rows examined:   ${leaked.length}`);
    console.log(`Merged into real:       ${COMMIT ? merged : `(would merge ${leaked.length - kept})`}`);
    console.log(`Kept (no sibling):      ${kept}`);
    console.log(`Preserved match links:  ${COMMIT ? preservedMatch : "?"}`);

    if (!COMMIT) console.log(`\n🟢 Dry run only. Re-run with --commit to mutate.`);
  } finally { await conn.end(); }
}

main().catch(err => { console.error("Crashed:", err); process.exit(1); });
