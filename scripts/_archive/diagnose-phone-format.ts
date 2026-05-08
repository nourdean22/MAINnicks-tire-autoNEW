import "dotenv/config";
import mysql from "mysql2/promise";
async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [a] = await conn.execute(`SELECT phone FROM customers WHERE phone IS NOT NULL AND phone != '' LIMIT 5`);
    const [b] = await conn.execute(`SELECT customer_phone FROM alg_estimates WHERE customer_phone IS NOT NULL LIMIT 5`);
    console.log("customers.phone samples:"); console.table(a);
    console.log("alg_estimates.customer_phone samples:"); console.table(b);

    // Try a fuzzy match: strip all non-digits + take last 10 chars
    const [matchAttempt] = await conn.execute(`
      SELECT COUNT(*) AS matched
      FROM alg_estimates e
      JOIN customers c ON RIGHT(REGEXP_REPLACE(e.customer_phone, '[^0-9]', ''), 10) = RIGHT(REGEXP_REPLACE(c.phone, '[^0-9]', ''), 10)
      WHERE e.matched_invoice_id IS NULL
    `);
    console.log("Fuzzy phone match (strip non-digits, last 10):"); console.table(matchAttempt);
  } finally { await conn.end(); }
}
main().catch(err => { console.error(err); process.exit(1); });
