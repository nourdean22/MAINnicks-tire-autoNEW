/**
 * Hand-apply migration 0144 — camera_runtime rolling-window plausibility counters.
 * Eight additive nullable columns on camera_runtime: two for the vehicle lane (what the
 * detector SAW in the last 10 / 60 minutes) and six for the office conversation worker
 * (what the last hour of LISTENING looked like). NULL = this producer does not report
 * the window; 0 = it looked and found none.
 *
 * Idempotent: each ADD COLUMN runs only if INFORMATION_SCHEMA says the column is absent,
 * and the table is proven to exist before any ALTER is attempted (2026-09-02: the first
 * apply of 0114 failed on a table no migration had ever created). Re-running is a no-op.
 * Records the file hash in __drizzle_migrations with the journal `when` as created_at,
 * exactly as scripts/db-migrate.ts would, so the reconcile gate sees it as applied.
 *
 * Run from apps/nickstire, with the production connection injected by Railway — never a
 * pasted key. The 2026-10-07 DVI apply (0143) ran this way as a one-off pre-deploy command
 * on the MAINnicks-tire-auto service, removed afterwards:
 *   pnpm --filter nicks-tire-auto exec tsx scripts/migrations/apply-camera-runtime-window-counters.ts
 *
 * Until it runs, every reader of these columns degrades on purpose: the heartbeat writer
 * drops only these eight fields (one log line) and lot.health / camera-health-alerts select
 * them only once INFORMATION_SCHEMA shows them (server/lib/heartbeatStorableColumns.ts).
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

const MIGRATION_TAG = "0144_camera_runtime_window_counters";
const MIGRATION_PATH = join(process.cwd(), "drizzle", `${MIGRATION_TAG}.sql`);
const JOURNAL_PATH = join(process.cwd(), "drizzle", "meta", "_journal.json");
const TABLE = "camera_runtime";
// Mirrors drizzle/0144_camera_runtime_window_counters.sql statement for statement.
const COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: "detectionsLast10m", ddl: "ALTER TABLE camera_runtime ADD COLUMN detectionsLast10m INT NULL" },
  { name: "portalCrossingsLast60m", ddl: "ALTER TABLE camera_runtime ADD COLUMN portalCrossingsLast60m INT NULL" },
  {
    name: "conversationListeningCoverage60m",
    ddl: "ALTER TABLE camera_runtime ADD COLUMN conversationListeningCoverage60m DECIMAL(5,4) NULL",
  },
  {
    name: "conversationCaptureSecondsLast60m",
    ddl: "ALTER TABLE camera_runtime ADD COLUMN conversationCaptureSecondsLast60m INT NULL",
  },
  { name: "conversationCapturesLast60m", ddl: "ALTER TABLE camera_runtime ADD COLUMN conversationCapturesLast60m INT NULL" },
  {
    name: "conversationCaptureFailuresLast60m",
    ddl: "ALTER TABLE camera_runtime ADD COLUMN conversationCaptureFailuresLast60m INT NULL",
  },
  {
    name: "conversationWakeTriggersLast60m",
    ddl: "ALTER TABLE camera_runtime ADD COLUMN conversationWakeTriggersLast60m INT NULL",
  },
  { name: "conversationTranscribeBacklog", ddl: "ALTER TABLE camera_runtime ADD COLUMN conversationTranscribeBacklog INT NULL" },
];

async function columnExists(connection: mysql.Connection, name: string): Promise<boolean> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
    [TABLE, name],
  );
  return rows.length === 1;
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
    const [tables] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1",
      [TABLE],
    );
    if (tables.length !== 1) throw new Error(`PRE-CHECK FAILED: table ${TABLE} does not exist in this database`);

    let applied = 0;
    let skipped = 0;
    for (const col of COLUMNS) {
      if (await columnExists(connection, col.name)) {
        skipped++;
        continue;
      }
      await connection.query(col.ddl);
      applied++;
    }

    for (const col of COLUMNS) {
      if (!(await columnExists(connection, col.name))) throw new Error(`POST-CHECK FAILED: ${TABLE}.${col.name} missing`);
    }

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
      `${MIGRATION_TAG}: ${applied} columns added, ${skipped} already present — all ${COLUMNS.length} verified; __drizzle_migrations ${ledger} (hash ${hash.slice(0, 12)})`,
    );
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(`${MIGRATION_TAG} FAILED:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
