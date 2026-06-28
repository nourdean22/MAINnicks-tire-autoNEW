import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });

async function main() {
  const { getDb } = await import("../server/db.ts");
  const { setFlag } = await import("../server/services/featureFlags.ts");
  const { runIgAutopost } = await import("../server/services/igAutopost.ts");

  console.log("Connecting to database...");
  const db = await getDb();
  if (!db) {
    console.error("Database connection failed");
    return;
  }

  try {
    console.log("Temporarily enabling legacy_autopost_live flag...");
    await setFlag("legacy_autopost_live", true);

    console.log("Launching live IG autoposter (dryRun: false)...");
    const result = await runIgAutopost({ dryRun: false });

    console.log("\n=== LIVE RUN GENERATION RESULT ===");
    console.log(JSON.stringify(result, null, 2));

  } catch (err) {
    console.error("Error during live run:", err);
  } finally {
    console.log("Reverting legacy_autopost_live flag back to false for safety...");
    await setFlag("legacy_autopost_live", false);
    console.log("Flag reset completed.");
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
});
