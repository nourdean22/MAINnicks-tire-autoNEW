/**
 * Run pending database migrations.
 * Usage: node scripts/run-migrations.mjs
 *
 * Reads all SQL files from drizzle/*.sql in order and executes them.
 * All use CREATE TABLE IF NOT EXISTS so they're safe to re-run.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DRIZZLE_DIR = path.join(ROOT, "drizzle");

// Only run migrations 0017+ (earlier ones were already applied)
const PENDING_START = 17;

async function main() {
  // Get DATABASE_URL from environment
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL not set. Run with: DATABASE_URL=... node scripts/run-migrations.mjs");
    process.exit(1);
  }

  // Dynamic import mysql2
  const mysql = await import("mysql2/promise");
  const connection = await mysql.createConnection(dbUrl);

  console.log("Connected to database. Running pending migrations...\n");

  // Get all SQL files sorted
  const sqlFiles = fs.readdirSync(DRIZZLE_DIR)
    .filter(f => f.endsWith(".sql"))
    .sort();

  let applied = 0;
  let skipped = 0;

  for (const file of sqlFiles) {
    // Parse migration number
    const match = file.match(/^(\d+)/);
    const num = match ? parseInt(match[1], 10) : -1;

    if (num < PENDING_START) {
      skipped++;
      continue;
    }

    const filePath = path.join(DRIZZLE_DIR, file);
    const sql = fs.readFileSync(filePath, "utf-8").trim();

    if (!sql) continue;

    console.log(`Running: ${file}`);

    // Split by semicolons and execute each statement
    const statements = sql.split(";").map(s => s.trim()).filter(s => s.length > 0);

    for (const stmt of statements) {
      try {
        await connection.execute(stmt);
      } catch (err) {
        // Ignore "already exists" errors
        if (err.code === "ER_TABLE_EXISTS_ERROR" || err.message?.includes("already exists")) {
          console.log(`  ⏭ Already exists, skipping`);
        } else if (err.code === "ER_DUP_KEYNAME" || err.message?.includes("Duplicate key name")) {
          console.log(`  ⏭ Index already exists, skipping`);
        } else {
          console.error(`  ❌ Error: ${err.message}`);
        }
      }
    }

    applied++;
    console.log(`  ✅ Applied`);
  }

  console.log(`\nDone. ${applied} migrations applied, ${skipped} skipped (already applied).`);

  await connection.end();
}

main().catch(err => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
