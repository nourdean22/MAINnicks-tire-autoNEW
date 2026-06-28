import { getDbTyped } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDbTyped();
  if (!db) {
    console.error("Database not available");
    process.exit(1);
  }
  try {
    const [result] = await db.execute(sql`SELECT COUNT(*) as count FROM nickgpt_drafts`);
    console.log("SUCCESS:", result);
  } catch (err) {
    console.error("FAILED:", err);
    process.exit(1);
  }
}

main().catch(console.error);
