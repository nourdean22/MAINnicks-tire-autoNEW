import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const MIGRATION_TAG = "0078_search_performance_drop_narrow_key";
const MIGRATION_PATH = join(process.cwd(), "drizzle", `${MIGRATION_TAG}.sql`);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  if (!url.startsWith("mysql://")) {
    throw new Error(
      `DATABASE_URL is not a mysql:// connection string (got "${url.split("://")[0]}://..."). ` +
        "This migration targets Nick's Tire's TiDB/MySQL database, not statenour's Postgres. Refusing.",
    );
  }

  const source = readFileSync(MIGRATION_PATH, "utf8");
  const statements = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const hash = createHash("sha256").update(source).digest("hex");
  const connection = await mysql.createConnection(url);

  try {
    const [before] = await connection.query<mysql.RowDataPacket[]>(
      "SHOW INDEX FROM search_performance WHERE Key_name = 'uq_search_perf_date_query_page'",
    );
    if (before.length === 0) {
      console.log("Narrow key already absent — nothing to do.");
    } else {
      for (const statement of statements) {
        try {
          await connection.query(statement);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/doesn't exist|can't drop|unknown key/i.test(msg)) {
            console.log("Narrow key already gone (race with a concurrent run) — skipped.");
          } else {
            throw err;
          }
        }
      }
    }

    const [after] = await connection.query<mysql.RowDataPacket[]>(
      "SHOW INDEX FROM search_performance",
    );
    const keyNames = [...new Set(after.map((r) => r.Key_name as string))];
    const narrowStillPresent = keyNames.includes("uq_search_perf_date_query_page");
    const widePresent = keyNames.includes("uq_search_perf_date_query_page_device_country_type");

    if (narrowStillPresent) throw new Error("POST-CHECK FAILED: narrow key still present after drop");
    if (!widePresent) throw new Error("POST-CHECK FAILED: wide key missing — table in unexpected state");

    console.log(`Post-check OK — narrow key absent, wide key present. Current keys: ${keyNames.join(", ")}`);

    await connection.query(
      "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)",
    );
    const [recorded] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1",
      [hash],
    );
    if (recorded.length === 0) {
      await connection.query(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        [hash, Date.now()],
      );
    }

    console.log(`${MIGRATION_TAG} applied and verified.`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
