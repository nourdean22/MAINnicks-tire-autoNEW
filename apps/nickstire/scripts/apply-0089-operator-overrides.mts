/**
 * Hand-apply drizzle/0089_operator_quality_overrides.sql (runner marks tracked
 * without executing — the 0083-0087 trap). Additive CREATE TABLE IF NOT EXISTS.
 * Run from apps/nickstire (needs operator authorization — writes to PROD DB):
 *
 *   pnpm exec tsx scripts/apply-0089-operator-overrides.mts
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.error("no database connection"); process.exit(1); }

const ddl = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../drizzle/0089_operator_quality_overrides.sql"), "utf-8");
// Strip comment LINES before splitting so the leading comment block never glues
// to the CREATE TABLE (the 0088 apply-script bug, verified against a bare dev DB).
const statements = ddl
  .replace(/^--.*$/gm, "")
  .split(/;\s*(?:\n|$)/)
  .map((s) => s.trim())
  .filter(Boolean);
if (statements.length !== 1) {
  console.error(`expected 1 DDL statement, parsed ${statements.length} — refusing`);
  process.exit(1);
}

for (const stmt of statements) {
  const name = stmt.match(/`(\w+)`/)?.[1] ?? "statement";
  await db.execute(sql.raw(stmt));
  console.log(`${name}: applied (IF NOT EXISTS — idempotent)`);
}

const res: unknown = await db.execute(sql.raw("SHOW COLUMNS FROM operator_quality_overrides"));
const cols = (res as [unknown[], unknown])[0];
console.log(`operator_quality_overrides: ${cols.length} columns present`);
console.log("done — operator quality-override store live");
process.exit(0);
