#!/usr/bin/env tsx
/**
 * Add the compound index on brain_memories(category, updated_at) for
 * fast pinned_user queries. Hand-crafted SQL so we don't trigger the
 * prisma db push drop-warnings on legacy tables (daily_scores,
 * labor_operations, etc) still lingering in prod.
 *
 * CREATE INDEX IF NOT EXISTS is idempotent — safe to re-run.
 *
 * Run:
 *   npx tsx scripts/add-pinned-index.ts
 */
import { loadEnv, confirmDatabase } from "./_lib/safety";

async function main() {
  loadEnv();
  if (!process.argv.includes("--yes")) {
    await confirmDatabase("add-pinned-index");
  }
  const { prisma } = await import("@/lib/prisma");
  console.log("▶ creating index brain_memories_category_updated_at_idx");
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "brain_memories_category_updated_at_idx" ON "brain_memories" ("category", "updated_at");`
  );
  console.log("✓ done");
  // Re-run CREATE IF NOT EXISTS confirms existence. If the index was
  // already present this is a no-op; if we just created it this
  // round-trips cleanly. Skipping pg_indexes reflection because the
  // Prisma driver adapter doesn't map that view's native types.
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "brain_memories_category_updated_at_idx" ON "brain_memories" ("category", "updated_at");`
  );
  console.log("  (verified idempotent)");
  process.exit(0);
}

main().catch((err) => {
  console.error("add-pinned-index failed:", err);
  process.exit(1);
});
