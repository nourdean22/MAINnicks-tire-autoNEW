import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

async function main(): Promise<void> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [byDay] = await conn.query(
      "SELECT DATE(`createdAt`) AS day, status, COUNT(*) AS n FROM sms_messages WHERE `createdAt` > NOW() - INTERVAL 7 DAY GROUP BY DATE(`createdAt`), status ORDER BY day DESC, status",
    );
    const [last6h] = await conn.query(
      "SELECT status, COUNT(*) AS n FROM sms_messages WHERE `createdAt` > NOW() - INTERVAL 6 HOUR GROUP BY status",
    );
    const [last24h] = await conn.query(
      "SELECT status, COUNT(*) AS n FROM sms_messages WHERE `createdAt` > NOW() - INTERVAL 24 HOUR GROUP BY status",
    );
    console.log("Daily breakdown:");
    console.log(JSON.stringify(byDay, null, 2));
    console.log("\nLast 24h:");
    console.log(JSON.stringify(last24h, null, 2));
    console.log("\nLast 6h:");
    console.log(JSON.stringify(last6h, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
