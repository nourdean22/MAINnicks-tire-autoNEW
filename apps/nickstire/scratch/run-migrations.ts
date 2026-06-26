import { handleRunMigrations } from "../server/routers/nick/intelligence";

async function main() {
  console.log("Running migrations...");
  const result = await handleRunMigrations();
  console.log("Migration result:", result);
  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  console.error("Migration script failed:", err);
  process.exit(1);
});
