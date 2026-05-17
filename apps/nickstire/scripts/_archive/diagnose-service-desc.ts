import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [withDesc] = await conn.execute(`SELECT COUNT(*) as c FROM invoices WHERE serviceDescription IS NOT NULL AND serviceDescription != ''`);
    const [empty] = await conn.execute(`SELECT COUNT(*) as c FROM invoices WHERE serviceDescription IS NULL OR serviceDescription = ''`);
    console.log("With serviceDescription:"); console.table(withDesc);
    console.log("Empty serviceDescription:"); console.table(empty);
    const [samples] = await conn.execute(`SELECT id, serviceDescription, vehicleInfo, totalAmount FROM invoices WHERE serviceDescription IS NOT NULL AND serviceDescription != '' ORDER BY id DESC LIMIT 10`);
    console.log("Samples (newest with descriptions):"); console.table(samples);

    // ALG-source-only breakdown
    const [algBreakdown] = await conn.execute(`SELECT
      COUNT(*) as total,
      SUM(CASE WHEN serviceDescription IS NULL OR serviceDescription = '' THEN 1 ELSE 0 END) as no_desc,
      SUM(CASE WHEN serviceDescription LIKE '%tire%' OR serviceDescription LIKE '%TIRE%' THEN 1 ELSE 0 END) as tire_in_desc,
      SUM(CASE WHEN vehicleInfo IS NOT NULL AND vehicleInfo != '' THEN 1 ELSE 0 END) as has_vehicle
    FROM invoices WHERE source='shopdriver'`);
    console.log("ALG-source breakdown:"); console.table(algBreakdown);
  } finally {
    await conn.end();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
