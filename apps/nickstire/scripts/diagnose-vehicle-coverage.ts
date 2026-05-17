import "dotenv/config";
import mysql from "mysql2/promise";
async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [r1] = await conn.execute(`SELECT COUNT(*) as has_vehicle FROM invoices WHERE vehicleInfo IS NOT NULL AND vehicleInfo != ''`);
    const [r2] = await conn.execute(`SELECT COUNT(*) as missing FROM invoices WHERE (vehicleInfo IS NULL OR vehicleInfo = '') AND source = 'shopdriver'`);
    const [samples] = await conn.execute(`SELECT id, customerName, vehicleInfo, totalAmount FROM invoices WHERE vehicleInfo IS NOT NULL AND vehicleInfo != '' ORDER BY id DESC LIMIT 5`);
    console.log("With vehicleInfo:"); console.table(r1);
    console.log("Still missing (shopdriver source):"); console.table(r2);
    console.log("Recent samples:"); console.table(samples);
  } finally {
    await conn.end();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
