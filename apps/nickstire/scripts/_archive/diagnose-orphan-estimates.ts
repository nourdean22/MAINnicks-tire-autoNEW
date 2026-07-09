/**
 * Wave-101 — diagnose ALG estimates whose phone doesn't match any
 * customer in the customers table. Those are recovery candidates we
 * can't surface in the customer 360 view.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [orphans] = await conn.execute(`
      SELECT COUNT(*) AS orphan_count,
             ROUND(SUM(estimated_amount)/100, 0) AS orphan_value
      FROM alg_estimates e
      WHERE matched_invoice_id IS NULL
        AND customer_phone IS NOT NULL
        AND CHAR_LENGTH(REGEXP_REPLACE(customer_phone, '[^0-9]', '')) >= 10
        AND NOT EXISTS (
          SELECT 1 FROM customers c
          WHERE RIGHT(REGEXP_REPLACE(c.phone, '[^0-9]', ''), 10) =
                RIGHT(REGEXP_REPLACE(e.customer_phone, '[^0-9]', ''), 10)
        )
    `);
    console.log("Orphan declined estimates (phone not in customers):"); console.table(orphans);

    // No-phone estimates
    const [noPhone] = await conn.execute(`
      SELECT COUNT(*) AS no_phone_count,
             ROUND(SUM(estimated_amount)/100, 0) AS no_phone_value
      FROM alg_estimates
      WHERE matched_invoice_id IS NULL
        AND (customer_phone IS NULL OR CHAR_LENGTH(REGEXP_REPLACE(customer_phone, '[^0-9]', '')) < 10)
    `);
    console.log("No-phone declined estimates:"); console.table(noPhone);

    // Sample 10 orphans
    const [samples] = await conn.execute(`
      SELECT external_id, customer_name, customer_phone, vehicle_info,
             ROUND(estimated_amount/100, 0) AS dollars, estimate_date
      FROM alg_estimates e
      WHERE matched_invoice_id IS NULL
        AND customer_phone IS NOT NULL
        AND CHAR_LENGTH(REGEXP_REPLACE(customer_phone, '[^0-9]', '')) >= 10
        AND NOT EXISTS (
          SELECT 1 FROM customers c
          WHERE RIGHT(REGEXP_REPLACE(c.phone, '[^0-9]', ''), 10) =
                RIGHT(REGEXP_REPLACE(e.customer_phone, '[^0-9]', ''), 10)
        )
      ORDER BY estimated_amount DESC LIMIT 10
    `);
    console.log("\nTop 10 orphans by amount (these would become NEW customers):"); console.table(samples);
  } finally { await conn.end(); }
}
main().catch(err => { console.error(err); process.exit(1); });
