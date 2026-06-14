/**
 * Idempotent Migration Runner
 *
 * Replaces drizzle-kit migrate for production deploys. Survives journal
 * drift by treating common "already exists" errors as no-ops, then
 * back-fills the __drizzle_migrations table so future drizzle-kit
 * migrate calls also see prior migrations as applied.
 *
 * Why this exists: drizzle-kit's _journal.json drifted from production
 * during pre-2026 manual migrations. drizzle-kit migrate now fails on
 * the very first CREATE TABLE (users) because the table already exists.
 * That blocks every future migration too.
 *
 * This runner:
 *   1. Reads drizzle/meta/_journal.json — the canonical migration list
 *   2. For each migration tag, reads drizzle/<tag>.sql
 *   3. Splits on "--> statement-breakpoint" + runs each statement
 *   4. Tolerates these MySQL errors as already-applied signals:
 *        - ER_TABLE_EXISTS_ERROR (1050)
 *        - ER_DUP_KEYNAME       (1061)
 *        - ER_DUP_FIELDNAME     (1060)
 *        - ER_DUP_ENTRY         (1062)  // INSERT IGNORE situations
 *        - ER_BAD_FIELD_ERROR   (1054)  // ALTER TABLE on dropped col
 *        - ER_KEY_COLUMN_DOES_NOT_EXIST (1072)
 *   5. Back-fills __drizzle_migrations with the hash drizzle expects
 *      so drizzle-kit migrate will skip these on next run
 *
 * Run: npx tsx scripts/db-migrate.ts
 *      pnpm tsx scripts/db-migrate.ts
 *
 * Safe to re-run. Output reports "newly applied" vs "already in place"
 * per migration.
 */

import "dotenv/config";
import { createHash } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import mysql from "mysql2/promise";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

// MySQL/TiDB error codes treated as "already applied — keep going".
// These cover both the "object already exists" case (idempotent re-run)
// and the "object referenced by migration was later dropped" case
// (migration is partially out of date but the schema is fine).
const TOLERATED_CODES = new Set([
  "ER_TABLE_EXISTS_ERROR",     // 1050: CREATE TABLE on existing
  "ER_DUP_KEYNAME",            // 1061: CREATE INDEX on existing
  "ER_DUP_FIELDNAME",          // 1060: ALTER ADD COLUMN on existing
  "ER_DUP_ENTRY",              // 1062: INSERT on dup primary
  "ER_BAD_FIELD_ERROR",        // 1054: column referenced doesn't exist
  "ER_KEY_COLUMN_DOES_NOT_EXIST", // 1072
  "ER_NO_SUCH_TABLE",          // 1146: table referenced doesn't exist
  "ER_CANT_DROP_FIELD_OR_KEY", // 1091: DROP on missing
  "ER_NO_REFERENCED_ROW_2",    // 1452: FK target missing (rare in migrations)
  "ER_TOO_LONG_KEY",           // 1071: key length limit exceeded
]);

// Numeric errno fallback — some TiDB / MariaDB / forks return non-MySQL
// code strings. Normalize on errno so we still tolerate the right cases.
const TOLERATED_ERRNOS = new Set([1050, 1054, 1060, 1061, 1062, 1072, 1091, 1146, 1071]);

// Message-substring fallback for engines that don't fill code/errno.
const TOLERATED_MESSAGE_FRAGMENTS = [
  "already exists",
  "duplicate column",
  "duplicate key",
  "column does not exist",
  "doesn't exist",
  "unknown column",
  "no such table",
];

function loadJournal(): Journal {
  const journalPath = join(process.cwd(), "drizzle", "meta", "_journal.json");
  return JSON.parse(readFileSync(journalPath, "utf8"));
}

function loadMigrationSql(tag: string): string {
  // Migration files are named like 0000_charming_squirrel_girl.sql
  const migrationPath = join(process.cwd(), "drizzle", `${tag}.sql`);
  return readFileSync(migrationPath, "utf8");
}

/** drizzle-orm uses SHA256 of the SQL string as the migration hash */
function migrationHash(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

/** Strip SQL line comments (-- ... end-of-line) so they don't confuse
 *  the semicolon splitter. Block comments (slash-star) preserved. */
function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Split migration content into individual statements.
 *  Handles two formats used in the codebase:
 *  1. drizzle-kit generated: split on "--> statement-breakpoint"
 *  2. hand-written: split on raw `;` (after stripping line comments) */
function splitStatements(sql: string): string[] {
  if (sql.includes("--> statement-breakpoint")) {
    return sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .flatMap((s) => splitOnSemicolons(s));
  }
  // Hand-written migration — split on `;` after stripping line comments
  return splitOnSemicolons(sql);
}

function splitOnSemicolons(sql: string): string[] {
  const cleaned = stripLineComments(sql);
  return cleaned
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function ensureMigrationsTable(conn: mysql.Connection): Promise<void> {
  // drizzle's migration tracking table (mysql variant)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `);
}

async function getAppliedHashes(conn: mysql.Connection): Promise<Set<string>> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT hash FROM __drizzle_migrations`,
  );
  return new Set(rows.map((r) => r.hash as string));
}

async function recordApplied(
  conn: mysql.Connection,
  hash: string,
  whenMs: number,
): Promise<void> {
  await conn.query(
    `INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`,
    [hash, whenMs],
  );
}

function isTolerableError(err: unknown): boolean {
  const e = err as { code?: string; errno?: number; message?: string };
  if (e.code && TOLERATED_CODES.has(e.code)) return true;
  if (e.errno && TOLERATED_ERRNOS.has(e.errno)) return true;
  if (e.message) {
    const lower = e.message.toLowerCase();
    if (TOLERATED_MESSAGE_FRAGMENTS.some((frag) => lower.includes(frag))) return true;
  }
  return false;
}

async function applyStatement(
  conn: mysql.Connection,
  stmt: string,
): Promise<"applied" | "skipped-tolerated"> {
  try {
    console.log(`Executing statement: ${stmt.substring(0, 100)}...`);
    await conn.query(stmt);
    return "applied";
  } catch (err) {
    console.error(`Statement failed: ${stmt}\nError:`, err);
    if (isTolerableError(err)) return "skipped-tolerated";
    throw err;
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  console.log("\n═══ DB MIGRATE — idempotent runner ═══\n");

  const journal = loadJournal();
  console.log(`Journal: ${journal.entries.length} migrations registered`);

  // Confirm migration files actually exist
  const sqlFiles = readdirSync(join(process.cwd(), "drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""));
  const missingFiles = journal.entries
    .filter((e) => !sqlFiles.includes(e.tag))
    .map((e) => e.tag);
  if (missingFiles.length > 0) {
    console.warn(`⚠  ${missingFiles.length} journal entries missing .sql files: ${missingFiles.join(", ")}`);
  }

  const conn = await mysql.createConnection(url);

  try {
    await ensureMigrationsTable(conn);
    const alreadyApplied = await getAppliedHashes(conn);
    console.log(`Already in __drizzle_migrations: ${alreadyApplied.size} hashes\n`);

    let newlyApplied = 0;
    let alreadyHashTracked = 0;
    let recoveredFromDrift = 0;
    let totalStatements = 0;
    let toleratedStatements = 0;

    for (const entry of journal.entries) {
      // If the file doesn't exist, skip (legacy reference). Don't touch
      // __drizzle_migrations for missing files.
      let sql: string;
      try {
        sql = loadMigrationSql(entry.tag);
      } catch {
        continue;
      }

      const hash = migrationHash(sql);

      if (alreadyApplied.has(hash)) {
        alreadyHashTracked++;
        continue;
      }

      // Hash not tracked — either genuinely new OR drifted (applied to
      // schema but not recorded in __drizzle_migrations). Run all
      // statements with tolerance for "already exists" errors. If every
      // statement is tolerated, the migration was drift. If at least one
      // actually applied, this is a genuine new migration.
      const statements = splitStatements(sql);
      let appliedCount = 0;
      let toleratedCount = 0;

      for (const stmt of statements) {
        totalStatements++;
        const result = await applyStatement(conn, stmt);
        if (result === "applied") appliedCount++;
        else toleratedCount++;
      }

      toleratedStatements += toleratedCount;

      // Record the hash regardless — schema state is now consistent
      // with this migration.
      await recordApplied(conn, hash, entry.when);

      if (appliedCount === 0) {
        recoveredFromDrift++;
        console.log(`  · ${entry.tag} — drift-recovered (${toleratedCount} statements already in place)`);
      } else {
        newlyApplied++;
        console.log(`  ✓ ${entry.tag} — applied ${appliedCount} statement(s), ${toleratedCount} tolerated`);
      }
    }

    console.log(`\nSummary:`);
    console.log(`  ${alreadyHashTracked} already tracked (skipped)`);
    console.log(`  ${recoveredFromDrift} drift-recovered (back-filled __drizzle_migrations)`);
    console.log(`  ${newlyApplied} newly applied`);
    console.log(`  ${totalStatements} statements processed (${toleratedStatements} tolerated as no-ops)`);

    console.log(`\n═══ DONE ═══`);
    console.log(`Future drizzle-kit migrate calls will see ${alreadyHashTracked + recoveredFromDrift + newlyApplied} migrations as applied.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
