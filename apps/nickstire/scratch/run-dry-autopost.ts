import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });

async function main() {
  const { getDb } = await import("../server/db.ts");
  const { runIgAutopost } = await import("../server/services/igAutopost.ts");

  console.log("Connecting to database...");
  const db = await getDb();
  if (!db) {
    console.error("Database connection failed");
    return;
  }

  try {
    console.log("Launching dry-run IG autoposter (dryRun: true)...");
    const result = await runIgAutopost({ dryRun: true });

    console.log("\n=== DRY RUN GENERATION RESULT ===");
    console.log(JSON.stringify(result, null, 2));

  } catch (err) {
    console.error("Error during dry run:", err);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
});
