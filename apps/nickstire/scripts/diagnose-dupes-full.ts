/**
 * Wave-97 dupe inventory — runs the audit queries against live DB.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    console.log("\n═══ INVOICE DUPE INVENTORY ═══\n");

    // Query A — true dupes by customerName+amount+date triple
    const [tripleRaw] = await conn.execute(`
      SELECT customerName, totalAmount, DATE(invoiceDate) AS day,
             COUNT(*) AS cnt,
             GROUP_CONCAT(id ORDER BY id) AS ids,
             GROUP_CONCAT(invoiceNumber ORDER BY id SEPARATOR ' | ') AS nums
      FROM invoices
      GROUP BY customerName, totalAmount, DATE(invoiceDate)
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC, day DESC
      LIMIT 30
    `);
    const triple = tripleRaw as Array<Record<string, unknown>>;
    console.log(`A. customerName + amount + day triples with >1 row: ${triple.length} (top 30 shown)`);
    console.table(triple);

    // Query B — UUID rows with sibling real invoice
    const [siblingRaw] = await conn.execute(`
      SELECT u.id AS uuid_id, u.invoiceNumber AS uuid_num, u.customerName, u.totalAmount,
             DATE(u.invoiceDate) AS u_day,
             r.id AS real_id, r.invoiceNumber AS real_num,
             ABS(DATEDIFF(u.invoiceDate, r.invoiceDate)) AS day_diff
      FROM invoices u
      JOIN invoices r
        ON r.customerName = u.customerName
        AND r.totalAmount = u.totalAmount
        AND ABS(DATEDIFF(u.invoiceDate, r.invoiceDate)) <= 3
        AND r.invoiceNumber NOT REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      WHERE u.invoiceNumber REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      LIMIT 30
    `);
    const siblings = siblingRaw as Array<Record<string, unknown>>;
    console.log(`\nB. UUID rows that have a sibling real-invoice (UUID = leaked, real = ground truth): ${siblings.length} matches (top 30 shown)`);
    console.table(siblings);

    // Query C — duplicate invoiceNumber values (should be 0 due to unique constraint)
    const [collisionRaw] = await conn.execute(`
      SELECT invoiceNumber, COUNT(*) AS cnt
      FROM invoices
      WHERE invoiceNumber IS NOT NULL AND invoiceNumber != ''
      GROUP BY invoiceNumber HAVING cnt > 1 LIMIT 10
    `);
    const collisions = collisionRaw as Array<Record<string, unknown>>;
    console.log(`\nC. Duplicate invoiceNumber values (unique constraint violations): ${collisions.length}`);
    if (collisions.length > 0) console.table(collisions);

    // Query D — overall date range of historical data
    const [dateRangeRaw] = await conn.execute(`
      SELECT
        MIN(invoiceDate) AS earliest,
        MAX(invoiceDate) AS latest,
        COUNT(*) AS total
      FROM invoices
    `);
    console.log(`\nD. Date range of invoices in DB:`);
    console.table(dateRangeRaw);

    // Query E — how far back does the data go in months?
    const [monthBuckets] = await conn.execute(`
      SELECT
        DATE_FORMAT(invoiceDate, '%Y-%m') AS month,
        COUNT(*) AS cnt,
        ROUND(SUM(totalAmount)/100, 0) AS dollars,
        SUM(CASE WHEN invoiceNumber REGEXP '^[0-9a-f]{8}-' THEN 1 ELSE 0 END) AS uuid_rows
      FROM invoices
      GROUP BY DATE_FORMAT(invoiceDate, '%Y-%m')
      ORDER BY month DESC LIMIT 24
    `);
    console.log(`\nE. Last 24 months of invoices (cnt + revenue + uuid_rows leaked):`);
    console.table(monthBuckets);
  } finally {
    await conn.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
