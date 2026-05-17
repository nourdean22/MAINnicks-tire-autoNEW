// v10.0.421 · apply mission_links migration to production DB
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { readFileSync } from "node:fs";

async function main() {
  const sql = readFileSync(
    "prisma/migrations/20260507164803_mission_links/migration.sql",
    "utf8",
  );
  // Split on ';' followed by newline · skip pure-comment chunks
  const stmts = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.split("\n").every((l) => l.trim() === "" || l.trim().startsWith("--")));

  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL,
  });
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
    console.log("\n✓ migration applied · mission_links table ready");

    // Verify
    const verify = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM mission_links`,
    );
    console.log(`  rows in mission_links: ${verify[0].count}`);

    // Mark migration as applied in _prisma_migrations
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'manual-apply-v10.0.421', NOW(), '20260507164803_mission_links', NULL, NULL, NOW(), 1)
       ON CONFLICT DO NOTHING`,
    ).catch((e) => {
      // _prisma_migrations may not exist if migrate deploy never ran · fine
      console.log(`  (skipped _prisma_migrations row: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"})`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
