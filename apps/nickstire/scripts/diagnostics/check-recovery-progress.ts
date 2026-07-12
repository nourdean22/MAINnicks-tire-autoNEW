import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const conn = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  const [r] = await conn.query(`
    SELECT
      SUM(CASE WHEN follow_up_7d_attempted_at IS NOT NULL THEN 1 ELSE 0 END) AS attempted_7d,
      SUM(CASE WHEN follow_up_7d_sent = 1 THEN 1 ELSE 0 END) AS sent_7d,
      SUM(CASE WHEN follow_up_30d_attempted_at IS NOT NULL THEN 1 ELSE 0 END) AS attempted_30d,
      SUM(CASE WHEN follow_up_30d_sent = 1 THEN 1 ELSE 0 END) AS sent_30d,
      MAX(follow_up_7d_attempted_at) AS latest_7d_claim,
      MAX(follow_up_30d_attempted_at) AS latest_30d_claim,
      MAX(follow_up_7d_sent_at) AS latest_7d_sent,
      MAX(follow_up_30d_sent_at) AS latest_30d_sent
    FROM alg_estimates
  `);
  console.log("ALG estimates recovery progress:");
  console.log(JSON.stringify((r as unknown as Array<Record<string, unknown>>)[0], null, 2));

  const [recent] = await conn.query(
    "SELECT status, COUNT(*) AS n FROM sms_messages WHERE `createdAt` > NOW() - INTERVAL 10 MINUTE GROUP BY status",
  );
  console.log("\nSMS messages in last 10 min:");
  console.log(JSON.stringify(recent, null, 2));
} finally {
  await conn.end();
}
