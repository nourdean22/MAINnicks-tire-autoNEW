import dotenv from "dotenv";
dotenv.config();

import { getAllFlags } from "../server/services/featureFlags";
import { getDb } from "../server/db";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Database connection failed. DATABASE_URL is:", process.env.DATABASE_URL);
    process.exit(1);
  }
  const flags = await getAllFlags();
  console.log("FEATURE FLAGS IN DATABASE:");
  for (const f of flags) {
    console.log(`- ${f.key}: ${f.value} (${f.description})`);
  }
}

main().catch(console.error);
