import { getDbTyped } from "../server/db";
import { leads } from "../drizzle/schema";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDbTyped();
  if (!db) {
    console.error("No DB connection");
    return;
  }
  try {
    console.log("Altering leads table source column...");
    await db.execute(sql`ALTER TABLE \`leads\` MODIFY COLUMN \`source\` enum('popup','chat','booking','manual','callback','fleet','financing_preapproval','sms','careers') NOT NULL DEFAULT 'popup'`);
    console.log("Success! Altered table.");
    
    console.log("Trying to insert test lead...");
    const res = await db.insert(leads).values({
      name: "SMS Test Inquiry",
      phone: "+12165551001",
      source: "sms",
      problem: "Tires price inquiry",
      urgencyScore: 3,
      status: "new",
    }).$returningId();
    console.log("Success! Inserted lead ID:", res);
  } catch (err: any) {
    console.error("Failed:", err);
  }
  process.exit(0);
}

main();
