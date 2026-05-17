import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.execute(
    `SELECT id, invoiceNumber, customerName, totalAmount, paymentStatus, source, invoiceDate
     FROM invoices
     WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
     ORDER BY id DESC LIMIT 20`
  );
  console.log("Last 20 invoices ingested in last 7d:");
  console.table(rows);
  await conn.end();
}
main().catch((err) => { console.error(err); process.exit(1); });
