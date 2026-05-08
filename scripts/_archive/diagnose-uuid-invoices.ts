import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  // UUID pattern: 8-4-4-4-12 hex chars
  const [uuidCount] = await conn.execute(`
    SELECT COUNT(*) as c, ROUND(SUM(totalAmount)/100, 2) as totalDollars
    FROM invoices
    WHERE invoiceNumber REGEXP '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  `);
  console.log("Invoices with UUID-style invoiceNumber (likely leaked estimates):");
  console.table(uuidCount);

  const [uuidSamples] = await conn.execute(`
    SELECT id, invoiceNumber, customerName, totalAmount, paymentStatus, invoiceDate
    FROM invoices
    WHERE invoiceNumber REGEXP '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    ORDER BY invoiceDate DESC LIMIT 20
  `);
  console.log("Sample UUID-numbered rows:");
  console.table(uuidSamples);

  // Last 30d breakdown: real numeric invoice numbers vs UUIDs
  const [comparison] = await conn.execute(`
    SELECT
      CASE
        WHEN invoiceNumber REGEXP '^[a-f0-9]{8}-' THEN 'uuid (leaked estimate)'
        WHEN invoiceNumber REGEXP '^[0-9]+$' THEN 'numeric (real invoice)'
        WHEN invoiceNumber LIKE 'Invoice#%' THEN 'Invoice# prefix'
        WHEN invoiceNumber LIKE 'Estimate#%' THEN 'Estimate# prefix'
        ELSE 'other'
      END as kind,
      COUNT(*) as c,
      ROUND(SUM(totalAmount)/100, 2) as totalDollars
    FROM invoices
    WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY kind ORDER BY c DESC
  `);
  console.log("Last 30d breakdown of invoiceNumber format (= revenue inflation source):");
  console.table(comparison);

  await conn.end();
}
main().catch((err) => { console.error(err); process.exit(1); });
