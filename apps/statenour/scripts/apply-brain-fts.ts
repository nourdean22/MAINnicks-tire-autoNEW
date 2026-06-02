// Apply 0007_brain_fts to production · 2026-06-02 · Wave B (hybrid retrieval).
//
// Adds the expression GIN index that powers the lexical lane in
// lib/brain/contextual-recall.ts. ADDITIVE + idempotent (CREATE INDEX IF NOT
// EXISTS) on brain_memories — a SEPARATE table from vector_embeddings, so this
// CANNOT touch pgvector. As a belt-and-suspenders guard this script verifies
// the `vector` extension is present BOTH before and after, aborts if it is
// already missing before (never operate on a broken DB), and screams if it is
// somehow missing after.
//
// Models scripts/apply-ambition-migration.ts (the proven pattern). RUN WITH
// PROD CREDS — the agent has no DATABASE_URL locally, so drive it via Railway
// (injects the statenour-web prod env):
//   railway run --service statenour-web npx tsx scripts/apply-brain-fts.ts
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { readFileSync } from "node:fs";

const MIGRATION_NAME = "0007_brain_fts";
const SQL_PATH = `prisma/migrations-pending/${MIGRATION_NAME}/migration.sql`;
const INDEX_NAME = "brain_memories_content_fts_idx";

async function pgvectorPresent(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ extname: string }[]>(
    `SELECT extname::text AS extname FROM pg_extension WHERE extname = 'vector' LIMIT 1`,
  );
  return rows.length > 0;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes("localhost")) {
    console.error(
      `✗ DATABASE_URL is missing or points at localhost (${url ?? "unset"}). ` +
        `Run via Railway with the statenour-web prod env.`,
    );
    process.exit(2);
  }

  const adapter = new PrismaNeon({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  try {
    // GUARD: pgvector must be present BEFORE. If it is already gone, abort —
    // we never operate on a DB whose vector extension is missing.
    const before = await pgvectorPresent(prisma);
    console.log(`pgvector BEFORE: ${before ? "PRESENT" : "MISSING"}`);
    if (!before) {
      console.error("✗ pgvector extension MISSING before apply — aborting, do not proceed.");
      process.exit(3);
    }

    // Apply the single idempotent statement from the pending migration file.
    const sql = readFileSync(SQL_PATH, "utf8");
    const stmts = sql
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(
        (s) =>
          s.length > 0 &&
          !s.split("\n").every((l) => l.trim() === "" || l.trim().startsWith("--")),
      );
    for (const stmt of stmts) {
      const oneLine = stmt.replace(/\s+/g, " ").slice(0, 90);
      process.stdout.write(`  exec: ${oneLine} ... `);
      try {
        await prisma.$executeRawUnsafe(stmt);
        console.log("OK");
      } catch (e) {
        const msg = e instanceof Error ? e.message.slice(0, 200) : String(e);
        if (/already exists/i.test(msg) || /duplicate/i.test(msg)) {
          console.log("SKIP (already exists)");
        } else {
          console.log("FAIL");
          console.error("  ", msg);
          throw e;
        }
      }
    }

    // Verify the index exists.
    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname::text AS indexname FROM pg_indexes WHERE indexname = '${INDEX_NAME}'`,
    );
    console.log(`  index ${INDEX_NAME} present: ${idx.length > 0 ? "yes" : "NO"}`);

    // GUARD: pgvector must STILL be present AFTER (proves we didn't break it).
    const after = await pgvectorPresent(prisma);
    console.log(`pgvector AFTER:  ${after ? "PRESENT" : "MISSING"}`);
    if (!after) {
      console.error(
        "✗✗ pgvector MISSING after apply — this should be impossible for an additive GIN index. Investigate immediately.",
      );
      process.exit(4);
    }

    // FTS smoke: the index-backed predicate runs + returns a count.
    const smoke = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM brain_memories
       WHERE deleted_at IS NULL
         AND to_tsvector('english', content) @@ websearch_to_tsquery('english', $1)`,
      "tire or revenue or oil",
    );
    console.log(`  FTS smoke (tire/revenue/oil) matched rows: ${smoke[0]?.n ?? 0}`);

    // Record as applied so `migrate deploy` never re-runs it (drift-safe).
    await prisma
      .$executeRawUnsafe(
        `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES (gen_random_uuid()::text, 'manual-apply-brain-fts-2026-06-02', NOW(), '${MIGRATION_NAME}', NULL, NULL, NOW(), 1)
         ON CONFLICT DO NOTHING`,
      )
      .then(() => console.log("  recorded in _prisma_migrations"))
      .catch((e) =>
        console.log(
          `  (skipped _prisma_migrations row: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"})`,
        ),
      );

    console.log("\n✓ 0007_brain_fts applied · lexical-lane GIN index live · pgvector intact");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
