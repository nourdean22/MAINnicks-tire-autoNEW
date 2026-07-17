/**
 * Hand-apply drizzle/0088_media_registry.sql (runner marks tracked without
 * executing — the 0083-0087 trap). Additive CREATE TABLE IF NOT EXISTS only.
 * Run from apps/nickstire:
 *
 *   pnpm exec tsx scripts/apply-0088-media-registry.mts
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.error("no database connection"); process.exit(1); }

const ddl = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../drizzle/0088_media_registry.sql"), "utf-8");
const statements = ddl.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("--"));

for (const stmt of statements) {
  const name = stmt.match(/`(\w+)`/)?.[1] ?? "statement";
  await db.execute(sql.raw(stmt));
  console.log(`${name}: applied (IF NOT EXISTS — idempotent)`);
}

for (const t of ["media_assets", "integration_tokens"]) {
  const res: unknown = await db.execute(sql.raw(`SHOW COLUMNS FROM ${t}`));
  const cols = (res as [unknown[], unknown])[0];
  console.log(`${t}: ${cols.length} columns present`);
}
console.log("done — media registry live");
process.exit(0);
