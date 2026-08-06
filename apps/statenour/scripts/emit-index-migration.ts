/**
 * Emit Index Migration SQL · v10.0.381
 *
 * Generates a Prisma-compatible migration.sql file containing CREATE
 * INDEX IF NOT EXISTS statements for every @@index declaration in
 * prisma/schema.prisma. Idempotent · safe to apply multiple times.
 *
 * Why handcrafted vs `prisma migrate dev --create-only`:
 *   · sandbox blocks Prisma migrate against the production DATABASE_URL
 *   · CREATE INDEX IF NOT EXISTS is non-destructive · zero data loss
 *   · The IF NOT EXISTS guard makes the SQL idempotent · re-runs are
 *     no-ops · safer than Prisma's standard generated migration that
 *     assumes the indexes don't yet exist
 *
 * What this skips:
 *   · Indexes that ALREADY exist in production (we can't know without
 *     introspecting · IF NOT EXISTS handles this at apply time)
 *   · Compound primary keys, unique constraints (Prisma manages these)
 *   · Existing @@index declarations from before v10.0.380 (script will
 *     emit them too · IF NOT EXISTS makes it safe)
 *
 * Output: prisma/migrations/<timestamp>_add_missing_indexes_v10_0_381/migration.sql
 *
 * Run: pnpm tsx scripts/emit-index-migration.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

const SCHEMA_PATH = path.resolve(__dirname, "..", "prisma", "schema.prisma");
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "prisma", "migrations");

function snakeCase(s: string): string {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

interface ModelDef {
  name: string;
  /** Effective table name · @@map override or PascalCase default. */
  tableName: string;
  /** Map from prisma field name to db column name (@map). */
  columnMap: Record<string, string>;
  indexes: string[][];
}

function parseSchema(content: string): ModelDef[] {
  const models: ModelDef[] = [];
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(content)) !== null) {
    const name = m[1];
    const body = m[2];
    let tableName = name; // default · Prisma uses PascalCase model name as table name
    const columnMap: Record<string, string> = {};
    const indexes: string[][] = [];

    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//")) continue;

      // @@map("table_name")
      const mapMatch = line.match(/@@map\(\s*"([^"]+)"\s*\)/);
      if (mapMatch) {
        tableName = mapMatch[1];
        continue;
      }

      // @@index([cols])
      const idxMatch = line.match(/@@index\(\s*\[([^\]]+)\]/);
      if (idxMatch) {
        const cols = idxMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/\(.*\)$/, ""));
        indexes.push(cols);
        continue;
      }

      // Field with @map("col_name")
      const fieldMatch = line.match(/^(\w+)\s+\w+/);
      if (fieldMatch) {
        const colMapMatch = line.match(/@map\(\s*"([^"]+)"\s*\)/);
        if (colMapMatch) {
          columnMap[fieldMatch[1]] = colMapMatch[1];
        }
      }
    }

    models.push({ name, tableName, columnMap, indexes });
  }
  return models;
}

function quotedColumn(prismaColName: string, model: ModelDef): string {
  const dbCol = model.columnMap[prismaColName] ?? prismaColName;
  return `"${dbCol}"`;
}

function indexNameOf(tableName: string, cols: string[], model: ModelDef): string {
  // Match Prisma's convention · TableName_col1_col2_idx
  //
  // 2026-08-06 · BUG FIX — this used the raw PRISMA FIELD names while the
  // CREATE INDEX body (quotedColumn, above) used the @map'd DB COLUMN names.
  // The name and the body therefore disagreed on every @map'd column, which
  // emitted things like:
  //
  //     CREATE INDEX IF NOT EXISTS "Mission_deletedAt_idx" ON "Mission" ("deleted_at");
  //
  // while earlier hand-written migrations had already created the same index
  // as "Mission_deleted_at_idx". `IF NOT EXISTS` matches on NAME, so it could
  // not see the existing index and created a SECOND, byte-identical one
  // instead of no-opping.
  //
  // That produced 42 duplicate index pairs across 24 tables (~18.7 MB) —
  // every write to those tables maintained two identical B-trees, and the
  // planner split scans arbitrarily between them. Dropped in the companion
  // migration; this line is why they must not come back.
  //
  // Mapping the columns here makes re-running this script genuinely
  // idempotent against the post-cleanup database.
  const mapped = cols.map((c) => model.columnMap[c] ?? c);
  const parts = [tableName, ...mapped, "idx"];
  let name = parts.join("_");
  // Postgres limit is 63 chars · truncate if needed
  if (name.length > 63) name = name.slice(0, 60) + "_x";
  return name;
}

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  EMIT INDEX MIGRATION · v10.0.381");
  console.log("═══════════════════════════════════════════════════════════");

  const content = fs.readFileSync(SCHEMA_PATH, "utf8");
  const models = parseSchema(content);

  const sqlLines: string[] = [
    "-- v10.0.381 · Add missing indexes for FK / createdAt / updatedAt /",
    "-- lastSeen / lastActiveAt / deletedAt / status columns. Idempotent",
    "-- via IF NOT EXISTS · safe to re-run.",
    "-- Generated by scripts/emit-index-migration.ts from schema.prisma.",
    "",
  ];

  let total = 0;
  for (const model of models) {
    if (model.indexes.length === 0) continue;
    const tableNameQuoted = `"${model.tableName}"`;
    const modelLines: string[] = [];
    for (const cols of model.indexes) {
      const colList = cols.map((c) => quotedColumn(c, model)).join(", ");
      const idxName = indexNameOf(model.tableName, cols, model);
      modelLines.push(
        `CREATE INDEX IF NOT EXISTS "${idxName}" ON ${tableNameQuoted} (${colList});`,
      );
      total++;
    }
    if (modelLines.length > 0) {
      sqlLines.push(`-- ── ${model.name} (${modelLines.length} indexes) ──`);
      sqlLines.push(...modelLines);
      sqlLines.push("");
    }
  }

  console.log(`  Parsed ${models.length} models`);
  console.log(`  Emitting ${total} CREATE INDEX IF NOT EXISTS statements`);

  // Use today's date (server-side timestamp) for the migration directory
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const migrationDir = path.join(
    MIGRATIONS_DIR,
    `${ts}_add_missing_indexes_v10_0_381`,
  );
  fs.mkdirSync(migrationDir, { recursive: true });
  const migrationFile = path.join(migrationDir, "migration.sql");
  fs.writeFileSync(migrationFile, sqlLines.join("\n") + "\n", "utf8");

  console.log("");
  console.log(`  ✅ Wrote migration file:`);
  console.log(`    ${migrationFile}`);
  console.log("");
  console.log("  Apply via:");
  console.log("    pnpm prisma migrate deploy   # apply to wherever DATABASE_URL points");
  console.log("");
  console.log("  Rollback (if needed) is manual · drop the indexes individually:");
  console.log('    DROP INDEX IF EXISTS "Mission_createdAt_idx"; etc.');
  console.log("");
}

main().catch((err) => {
  console.error("❌ Emit failed:", err);
  process.exit(1);
});
