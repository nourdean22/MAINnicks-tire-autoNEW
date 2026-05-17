import "dotenv/config";
import mysql from "mysql2/promise";
async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    // Group invoices by date + has-description to find the cutoff
    const [byMonth] = await conn.execute(`
      SELECT
        DATE_FORMAT(invoiceDate, '%Y-%m') AS month,
        COUNT(*) AS total,
        SUM(CASE WHEN serviceDescription IS NOT NULL AND serviceDescription != '' THEN 1 ELSE 0 END) AS with_desc,
        SUM(CASE WHEN serviceDescription IS NULL OR serviceDescription = '' THEN 1 ELSE 0 END) AS no_desc,
        SUM(CASE WHEN source = 'shopdriver' THEN 1 ELSE 0 END) AS shopdriver_count,
        SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) AS manual_count
      FROM invoices
      GROUP BY month ORDER BY month DESC LIMIT 30
    `);
    console.log("Description coverage by month:"); console.table(byMonth);

    // What unique words/phrases appear in descriptions?
    const [topPhrases] = await conn.execute(`
      SELECT serviceDescription, COUNT(*) as cnt
      FROM invoices
      WHERE serviceDescription IS NOT NULL AND serviceDescription != ''
      GROUP BY serviceDescription ORDER BY cnt DESC LIMIT 10
    `);
    console.log("\nTop description phrases:"); console.table(topPhrases);

    // Are descriptions populated only for invoices with line items elsewhere?
    const [latest] = await conn.execute(`
      SELECT id, invoiceNumber, customerName, serviceDescription, partsCost, laborCost, taxAmount, source, createdAt
      FROM invoices
      WHERE serviceDescription IS NOT NULL AND serviceDescription != ''
      ORDER BY id DESC LIMIT 5
    `);
    console.log("\nLatest with descriptions (when were they ingested?):"); console.table(latest);
    const [oldestWithDesc] = await conn.execute(`
      SELECT id, invoiceNumber, customerName, serviceDescription, partsCost, laborCost, source, createdAt
      FROM invoices
      WHERE serviceDescription IS NOT NULL AND serviceDescription != ''
      ORDER BY id ASC LIMIT 3
    `);
    console.log("\nOldest with descriptions:"); console.table(oldestWithDesc);
  } finally { await conn.end(); }
}
main().catch(err => { console.error(err); process.exit(1); });
