import "dotenv/config";
import { createHash } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import mysql from "mysql2/promise";
import { isTolerableError } from "./migration-tolerance";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}
interface Journal { version: string; dialect: string; entries: JournalEntry[] }

const drizzleDir = join(process.cwd(), "drizzle");

function loadMigrationEntries(): JournalEntry[] {
  const journalPath = join(drizzleDir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  const journalTags = new Set(journal.entries.map((entry) => entry.tag));
  const sqlTags = readdirSync(drizzleDir)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .map((file) => file.replace(/\.sql$/, ""))
    .sort();
  const discovered = sqlTags
    .filter((tag) => !journalTags.has(tag))
    .map((tag, offset): JournalEntry => ({
      idx: journal.entries.length + offset,
      version: journal.version,
      when: Date.now() + offset,
      tag,
      breakpoints: true,
    }));
  if (discovered.length > 0) {
    console.log(`Discovered ${discovered.length} unjournaled migration(s): ${discovered.map((entry) => entry.tag).join(", ")}`);
  }
  return [...journal.entries, ...discovered];
}

function loadMigrationSql(tag: string): string {
  return readFileSync(join(drizzleDir, `${tag}.sql`), "utf8");
}

function migrationHash(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trimEnd())
    .filter(Boolean)
    .join("\n");
}

function splitOnSemicolons(sql: string): string[] {
  return stripLineComments(sql)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function splitStatements(sql: string): string[] {
  if (!sql.includes("--> statement-breakpoint")) return splitOnSemicolons(sql);
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .flatMap(splitOnSemicolons);
}

async function ensureMigrationsTable(conn: mysql.Connection): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `);
}

async function getAppliedHashes(conn: mysql.Connection): Promise<Set<string>> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT hash FROM __drizzle_migrations`);
  return new Set(rows.map((row) => row.hash as string));
}

async function applyStatement(conn: mysql.Connection, statement: string): Promise<"applied" | "tolerated"> {
  try {
    console.log(`Executing statement: ${statement.substring(0, 100)}...`);
    await conn.query(statement);
    return "applied";
  } catch (error) {
    if (isTolerableError(error)) return "tolerated";
    throw error;
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  const entries = loadMigrationEntries();
  const conn = await mysql.createConnection(url);
  try {
    await ensureMigrationsTable(conn);
    const appliedHashes = await getAppliedHashes(conn);
    let newlyApplied = 0;
    let driftRecovered = 0;
    let alreadyTracked = 0;

    for (const entry of entries) {
      let migrationSql: string;
      try {
        migrationSql = loadMigrationSql(entry.tag);
      } catch {
        console.warn(`Skipping missing migration file: ${entry.tag}`);
        continue;
      }
      const hash = migrationHash(migrationSql);
      if (appliedHashes.has(hash)) {
        alreadyTracked += 1;
        continue;
      }
      const results = [];
      for (const statement of splitStatements(migrationSql)) {
        results.push(await applyStatement(conn, statement));
      }
      await conn.query(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [hash, entry.when]);
      if (results.every((result) => result === "tolerated")) driftRecovered += 1;
      else newlyApplied += 1;
      console.log(`Applied migration ${entry.tag}: ${results.filter((result) => result === "applied").length} statement(s), ${results.filter((result) => result === "tolerated").length} tolerated`);
    }

    console.log(`Migration summary: ${alreadyTracked} tracked, ${driftRecovered} drift-recovered, ${newlyApplied} newly applied`);
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
