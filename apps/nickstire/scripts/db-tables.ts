import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Database connection failed");
    process.exit(1);
  }

  // Get all database names on the MySQL server
  const databases: any[] = await db.execute(sql`SHOW DATABASES`);
  console.log("Databases on server:");
  for (const d of databases[0]) {
    console.log(`- ${Object.values(d)[0]}`);
  }

  process.exit(0);
}

main().catch(console.error);
