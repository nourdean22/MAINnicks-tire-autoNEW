import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const conn = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  const [t] = await conn.query("SHOW TABLES LIKE 'drip_enrollments'");
  const exists = (t as unknown[]).length > 0;
  console.log(`drip_enrollments table exists: ${exists}`);

  if (exists) {
    const [r] = await conn.query("SELECT COUNT(*) AS n FROM drip_enrollments");
    console.log(`Row count: ${JSON.stringify(r)}`);

    const [dup] = await conn.query(`
      SELECT customerPhone, campaignId, status, COUNT(*) AS dup
      FROM drip_enrollments
      GROUP BY customerPhone, campaignId, status
      HAVING dup > 1
      LIMIT 10
    `);
    console.log(`Duplicates by (phone, campaign, status) — must be zero to add unique:`);
    console.log(JSON.stringify(dup, null, 2));

    const [idx] = await conn.query("SHOW INDEX FROM drip_enrollments");
    const cleaned = (idx as Array<{ Key_name: string; Column_name: string; Non_unique: number }>)
      .reduce<Record<string, { cols: string[]; unique: boolean }>>((acc, r) => {
        const k = r.Key_name;
        if (!acc[k]) acc[k] = { cols: [], unique: r.Non_unique === 0 };
        acc[k].cols.push(r.Column_name);
        return acc;
      }, {});
    console.log(`Existing indexes:`);
    console.log(JSON.stringify(cleaned, null, 2));
  }

  // Also pull cron_alerts_fired stats since I'm adding cleanup for it
  console.log(`\ncron_alerts_fired state:`);
  const [ca] = await conn.query("SELECT COUNT(*) AS n FROM cron_alerts_fired");
  console.log(JSON.stringify(ca, null, 2));
} finally {
  await conn.end();
}
