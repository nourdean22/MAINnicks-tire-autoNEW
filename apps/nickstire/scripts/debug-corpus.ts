import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Database connection failed");
    process.exit(1);
  }

  // Get total count of communication_log
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sql.raw('communication_log'));
  console.log("Total rows in communication_log:", count);

  // Direction count for communication_log
  const directions = await db
    .select({
      direction: sql<string>`direction`,
      count: sql<number>`count(*)`
    })
    .from(sql.raw('communication_log'))
    .groupBy(sql.raw('direction'));
  console.log("direction counts in communication_log:", directions);

  // Sample rows from communication_log
  const rows: any = await db.execute(sql`SELECT * FROM communication_log LIMIT 10`);
  console.log("Sample communication_log rows:");
  for (const r of rows[0]) {
    console.log(`ID: ${r.id}, Phone: ${r.customerPhone || r.customer_phone}, Type: ${r.type}, Dir: ${r.direction}, Body: ${r.body?.slice(0, 100)}`);
  }

  process.exit(0);
}

main().catch(console.error);
