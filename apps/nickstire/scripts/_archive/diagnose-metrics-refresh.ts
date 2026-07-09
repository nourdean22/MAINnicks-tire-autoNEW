import "dotenv/config";
import mysql from "mysql2/promise";
async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [totals] = await conn.execute(`
      SELECT
        COUNT(*) AS total_rows,
        SUM(CASE WHEN declinedValue > 0 THEN 1 ELSE 0 END) AS with_declined,
        ROUND(SUM(declinedValue)/100, 0) AS sum_declined,
        SUM(CASE WHEN backlogValueCents > 0 THEN 1 ELSE 0 END) AS with_backlog,
        ROUND(SUM(backlogValueCents)/100, 0) AS sum_backlog,
        MAX(computedAt) AS last_refreshed
      FROM customer_metrics
    `);
    console.log("Aggregate rollup:"); console.table(totals);

    // Top 5 customers by declined value
    const [topDeclined] = await conn.execute(`
      SELECT c.firstName, c.lastName, c.phone,
             ROUND(m.declinedValue/100, 0) AS declined_dollars,
             m.declinedCount,
             ROUND(m.backlogValueCents/100, 0) AS backlog_dollars,
             m.backlogCount
      FROM customer_metrics m
      JOIN customers c ON c.id = m.customerId
      WHERE m.declinedValue > 0
      ORDER BY m.declinedValue DESC LIMIT 10
    `);
    console.log("\nTop 10 customers by declined work:"); console.table(topDeclined);
  } finally { await conn.end(); }
}
main().catch(err => { console.error(err); process.exit(1); });
