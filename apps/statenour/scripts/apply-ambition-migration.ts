// Apply the Ambition Engine P1 migration to production · 2026-05-30
//
// Models scripts/apply-mission-links-migration.ts (the proven pattern):
// applies each statement idempotently (skips "already exists") + records the
// migration in _prisma_migrations so a later `migrate deploy` won't re-run it
// (no drift). Additive only — zero data loss.
//
// RUN WITH PROD CREDS (this is the step the agent can't do — no DATABASE_URL
// in its env). From a Railway shell, OR locally after pulling prod env:
//   vercel env pull .env.production.local   # or set DATABASE_URL=<prod neon>
//   pnpm tsx scripts/apply-ambition-migration.ts
//
// AFTER it succeeds: restore the LifeGoal fields + GoalStat model in
// prisma/schema.prisma (see docs/specs/2026-05-30-ambition-engine.md), run
// `pnpm prisma generate`, then the P1 code can be built + shipped.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { readFileSync } from "node:fs";

const MIGRATION_NAME = "0003_ambition_engine";
const SQL_PATH = `prisma/migrations-pending/${MIGRATION_NAME}/migration.sql`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes("localhost")) {
    console.error(
      `✗ DATABASE_URL is missing or points at localhost (${url ?? "unset"}).\n` +
        `  This must run with the PRODUCTION Neon connection string. Pull prod env first.`,
    );
    process.exit(2);
  }

  const sql = readFileSync(SQL_PATH, "utf8");
  // Split on ';' followed by newline · skip pure-comment chunks (mirrors the
  // mission_links apply script).
  const stmts = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 0 &&
        !s.split("\n").every((l) => l.trim() === "" || l.trim().startsWith("--")),
    );

  const adapter = new PrismaNeon({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  try {
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
    console.log("\n✓ Ambition Engine migration applied · LifeGoal columns + goal_stats ready");

    // Verify
    const cols = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM information_schema.columns
       WHERE table_name = 'life_goals' AND column_name IN
       ('kind','parentGoalId','conviction','ambition','lastChallengedAt','killCriteria','killBy','identityLine')`,
    );
    console.log(`  new LifeGoal columns present: ${cols[0].count}/8`);
    const tbl = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM information_schema.tables WHERE table_name = 'goal_stats'`,
    );
    console.log(`  goal_stats table present: ${tbl[0].count === 1n ? "yes" : "NO"}`);

    // Record as applied so `migrate deploy` never re-runs it (drift-safe).
    await prisma
      .$executeRawUnsafe(
        `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES (gen_random_uuid()::text, 'manual-apply-ambition-2026-05-30', NOW(), '${MIGRATION_NAME}', NULL, NULL, NOW(), 1)
         ON CONFLICT DO NOTHING`,
      )
      .catch((e) => {
        console.log(
          `  (skipped _prisma_migrations row: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"})`,
        );
      });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
