/**
 * Hand-apply migration 0145 — vehicle_visit_marks (operator marks on a visit, audit N1).
 *
 * One additive table. Idempotent: CREATE TABLE IF NOT EXISTS, with an INFORMATION_SCHEMA
 * read before and after so the receipt says "created" or "already present", never a guess.
 * Records the file hash in __drizzle_migrations with the journal `when` as created_at,
 * exactly as scripts/db-migrate.ts would, so the reconcile gate sees it as applied.
 *
 * Run from apps/nickstire with the production connection injected by Railway (a one-off
 * pre-deploy command on the MAINnicks-tire-auto service, removed afterwards), like 0143 and
 * 0144 before it:
 *   pnpm --filter nicks-tire-auto exec tsx scripts/migrations/apply-vehicle-visit-marks.ts
 *
 * Until it runs: lot.markVisit answers { ok: false, reason: "...migration 0145..." } and the
 * floor board renders no mark buttons (marksAvailable: false), never a silent no-op.
 *
 * Writes to the production database — operator approval first (AGENTS.md, Protected
 * operations). Read .claude/skills/prod-db-guard/SKILL.md.
 */
import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const MIGRATION_TAG = "0145_vehicle_visit_marks";
const MIGRATION_PATH = join(process.cwd(), "drizzle", `${MIGRATION_TAG}.sql`);
const JOURNAL_PATH = join(process.cwd(), "drizzle", "meta", "_journal.json");
const TABLE = "vehicle_visit_marks";
// Mirrors drizzle/0145_vehicle_visit_marks.sql statement for statement.
const DDL = `CREATE TABLE IF NOT EXISTS vehicle_visit_marks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  visitId VARCHAR(64) NOT NULL,
  mark VARCHAR(32) NOT NULL,
  markedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  markedBy VARCHAR(191) NOT NULL,
  note VARCHAR(191) NULL,
  INDEX idx_vehicle_visit_marks_visit (visitId, markedAt)
)`;
const COLUMNS = ["id", "visitId", "mark", "markedAt", "markedBy", "note"];

async function tableExists(connection: mysql.Connection): Promise<boolean> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1",
    [TABLE],
  );
  return rows.length === 1;
}

async function columnNames(connection: mysql.Connection): Promise<string[]> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [TABLE],
  );
  return rows.map((r) => String(r.name));
}

/** The journal `when` for this tag: what scripts/db-migrate.ts records as created_at. */
function journalWhen(): number {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as { entries: Array<{ tag: string; when: number }> };
  const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
  if (!entry) throw new Error(`${MIGRATION_TAG} is not in drizzle/meta/_journal.json`);
  return entry.when;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  if (!url.startsWith("mysql://")) {
    throw new Error(
      `DATABASE_URL is not a mysql:// connection string (got "${url.split("://")[0]}://..."). ` +
        "This migration targets Nick's Tire's TiDB/MySQL database, not statenour's Postgres. " +
        "Refusing to run against the wrong database.",
    );
  }

  const source = readFileSync(MIGRATION_PATH, "utf8");
  const hash = createHash("sha256").update(source).digest("hex");
  const when = journalWhen();
  const connection = await mysql.createConnection(url);

  try {
    const before = await tableExists(connection);
    if (!before) await connection.query(DDL);
    if (!(await tableExists(connection))) throw new Error(`POST-CHECK FAILED: table ${TABLE} missing after CREATE`);
    const present = await columnNames(connection);
    const missing = COLUMNS.filter((c) => !present.includes(c));
    if (missing.length) throw new Error(`POST-CHECK FAILED: ${TABLE} lacks columns ${missing.join(", ")}`);

    await connection.query(
      "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)",
    );
    const [recorded] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1",
      [hash],
    );
    let ledger = "already recorded";
    if (recorded.length === 0) {
      await connection.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [hash, when]);
      ledger = `recorded created_at=${when}`;
    }

    console.log(
      `${MIGRATION_TAG}: table ${before ? "already present" : "created"}, ${COLUMNS.length} columns verified; __drizzle_migrations ${ledger} (hash ${hash.slice(0, 12)})`,
    );
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(`${MIGRATION_TAG} FAILED:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
