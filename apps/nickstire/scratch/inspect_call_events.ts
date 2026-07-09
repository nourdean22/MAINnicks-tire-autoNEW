import { getDb } from "./server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("DB unavailable");
    return;
  }
  const [cols] = await db.execute(sql`DESCRIBE call_events`);
  console.log("call_events cols:", cols);
  process.exit(0);
}
main();
