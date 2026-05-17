/**
 * Apply Index SQL Direct · v10.0.381
 *
 * Reads the v10.0.381 migration SQL file and executes each
 * CREATE INDEX IF NOT EXISTS statement against the live DB.
 * Bypasses Prisma migrate (the project uses prisma db push, not
 * migrate, so the migration history isn't baselined).
 *
 * Why this is safe:
 *   · Every statement is CREATE INDEX IF NOT EXISTS · idempotent
 *   · Zero DROP / ALTER / DELETE · purely additive
 *   · Postgres CREATE INDEX takes a brief lock on the table · for
 *     large tables consider editing the SQL to use CONCURRENTLY
 *     before running this. Our largest tables are operator-scale
 *     (low millions of rows max) · default lock pattern is fine.
 *
 * Run: pnpm tsx -r dotenv/config scripts/apply-index-sql.ts
 *      dotenv_config_path=.env
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "@/lib/prisma";

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "prisma", "migrations");

function findLatestIndexMigration(): string | null {
  const dirs = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.includes("add_missing_indexes_v10_0_381"))
    .map((d) => d.name)
    .sort();
  if (dirs.length === 0) return null;
  return path.join(MIGRATIONS_DIR, dirs[dirs.length - 1], "migration.sql");
}

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  APPLY INDEX SQL · v10.0.381");
  console.log("═══════════════════════════════════════════════════════════");

  const sqlFile = findLatestIndexMigration();
  if (!sqlFile) {
    console.error("❌ No migration file found. Run scripts/emit-index-migration.ts first.");
    process.exit(1);
  }
  console.log(`  Reading ${path.relative(path.resolve(__dirname, ".."), sqlFile)}`);

  const sql = fs.readFileSync(sqlFile, "utf8");
  // Split on semicolon at end-of-line · preserve comments · skip empty
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("--") && /^CREATE INDEX/i.test(s));

  console.log(`  Statements to execute: ${statements.length}`);
  console.log("");

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ stmt: string; err: string }> = [];

  for (const stmt of statements) {
    const idxName = stmt.match(/IF NOT EXISTS "([^"]+)"/)?.[1] ?? "?";
    try {
      await prisma.$executeRawUnsafe(stmt);
      ok++;
      if (ok % 25 === 0) console.log(`  ... ${ok}/${statements.length} done`);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // Postgres returns "relation does not exist" on tables that may have
      // been retired but still appear in old schema · skip those gracefully
      if (/relation .* does not exist/.test(msg)) {
        skipped++;
        errors.push({ stmt: idxName, err: "table_not_found" });
        continue;
      }
      // Already exists is fine (IF NOT EXISTS should prevent it but races)
      if (/already exists/i.test(msg)) {
        skipped++;
        continue;
      }
      failed++;
      errors.push({ stmt: idxName, err: msg.slice(0, 200) });
    }
  }

  console.log("");
  console.log(`  ✅ Created  · ${ok}`);
  console.log(`  ⏭  Skipped  · ${skipped} (already existed or table missing)`);
  if (failed > 0) {
    console.log(`  ❌ Failed   · ${failed}`);
    console.log("");
    console.log("  Failure details:");
    for (const e of errors.filter((e) => e.err !== "table_not_found").slice(0, 10)) {
      console.log(`    · ${e.stmt} · ${e.err}`);
    }
  }

  console.log("");
  console.log(`  Total processed: ${ok + skipped + failed} / ${statements.length}`);
  console.log("");

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Apply failed:", err);
  process.exit(1);
});
