/**
 * Create automation_policy_fires table via raw SQL · v10.0.169 hotfix
 *
 * Avoids the pgvector + tsvector drop trap: `prisma db push` would
 * try to drop the raw-SQL columns Prisma can't model (embedding_vec,
 * embedding_vec_1536, searchable_tsv) every time we add a Prisma-
 * tracked table. Per AGENTS.md, --accept-data-loss is forbidden.
 *
 * Solution: create the new table via raw SQL. Idempotent (CREATE
 * TABLE IF NOT EXISTS) so it's safe to re-run.
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

async function main() {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    console.log("[1/3] create automation_policy_fires table…");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS automation_policy_fires (
        id              TEXT PRIMARY KEY,
        policy_id       TEXT NOT NULL REFERENCES automation_policies(id) ON DELETE CASCADE,
        fired_at        TIMESTAMP(3) NOT NULL DEFAULT now(),
        result          TEXT NOT NULL,
        result_message  TEXT,
        duration_ms     INT,
        metadata        JSONB
      )
    `);
    console.log("  table ready");

    console.log("[2/3] create indexes…");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS automation_policy_fires_policy_id_fired_at_idx
      ON automation_policy_fires (policy_id, fired_at DESC)
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS automation_policy_fires_fired_at_idx
      ON automation_policy_fires (fired_at DESC)
    `);
    console.log("  indexes ready");

    console.log("[3/3] verify…");
    const cols = await prisma.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(`
      SELECT column_name::text AS column_name, data_type::text AS data_type
      FROM information_schema.columns
      WHERE table_name = 'automation_policy_fires'
      ORDER BY ordinal_position
    `);
    console.log(`  ${cols.length} columns:`);
    for (const c of cols) console.log(`    · ${c.column_name} (${c.data_type})`);
    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(`
      SELECT indexname::text FROM pg_indexes WHERE tablename = 'automation_policy_fires'
    `);
    console.log(`  ${idx.length} indexes: ${idx.map((i) => i.indexname).join(", ")}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
