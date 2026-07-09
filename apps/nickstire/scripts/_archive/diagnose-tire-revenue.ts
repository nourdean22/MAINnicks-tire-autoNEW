import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    // Tire revenue by month
    const [byMonth] = await conn.execute(`
      SELECT DATE_FORMAT(invoiceDate, '%Y-%m') AS month,
             COUNT(*) AS tire_jobs,
             ROUND(SUM(totalAmount)/100, 0) AS tire_revenue,
             ROUND(AVG(totalAmount)/100, 0) AS avg_ticket
      FROM invoices
      WHERE source='shopdriver' AND paymentStatus='paid'
        AND (serviceDescription LIKE '%tire%' OR serviceDescription LIKE '%TIRE%')
      GROUP BY month ORDER BY month DESC LIMIT 24
    `);
    console.log("Tire-job revenue by month:"); console.table(byMonth);

    // Top tire-job descriptions (what types of tire work most common)
    const [topDescs] = await conn.execute(`
      SELECT serviceDescription, COUNT(*) AS cnt,
             ROUND(SUM(totalAmount)/100, 0) AS revenue
      FROM invoices
      WHERE source='shopdriver' AND paymentStatus='paid'
        AND (serviceDescription LIKE '%tire%' OR serviceDescription LIKE '%TIRE%')
      GROUP BY serviceDescription ORDER BY cnt DESC LIMIT 15
    `);
    console.log("\nTop tire-job descriptions:"); console.table(topDescs);

    // Top tire customers (LTV from tire work)
    const [topCustomers] = await conn.execute(`
      SELECT customerName, COUNT(*) AS jobs,
             ROUND(SUM(totalAmount)/100, 0) AS spent
      FROM invoices
      WHERE source='shopdriver' AND paymentStatus='paid'
        AND (serviceDescription LIKE '%tire%' OR serviceDescription LIKE '%TIRE%')
      GROUP BY customerName ORDER BY spent DESC LIMIT 10
    `);
    console.log("\nTop tire customers:"); console.table(topCustomers);

    // All-time tire totals
    const [totals] = await conn.execute(`
      SELECT COUNT(*) AS total_tire_jobs,
             ROUND(SUM(totalAmount)/100, 0) AS total_tire_revenue,
             ROUND(AVG(totalAmount)/100, 0) AS avg_tire_ticket,
             COUNT(DISTINCT customerName) AS unique_customers
      FROM invoices
      WHERE source='shopdriver' AND paymentStatus='paid'
        AND (serviceDescription LIKE '%tire%' OR serviceDescription LIKE '%TIRE%')
    `);
    console.log("\nAll-time tire totals:"); console.table(totals);
  } finally {
    await conn.end();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
