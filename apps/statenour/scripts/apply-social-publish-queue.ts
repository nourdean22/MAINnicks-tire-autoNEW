// Apply 20260623000000_add_social_publish_queue to production · 2026-06-23 · Phase 3.
//
// Adds the social_publish_queue table and indexes.
// pgvector-safe: touches only ordinary tables/columns. NEVER run via
// `prisma db push --accept-data-loss`.
//
// Runs using database URL from .env.local / .env.
//   pnpm tsx scripts/apply-social-publish-queue.ts

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { readFileSync } from "node:fs";

const MIGRATION_NAME = "20260623000000_add_social_publish_queue";
const SQL_PATH = `prisma/migrations-pending/${MIGRATION_NAME}/migration.sql`;

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
        `Please configure .env.local with Neon credentials.`,
    );
    process.exit(2);
  }

  const adapter = new PrismaNeon({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  try {
    // GUARD: pgvector must be present BEFORE. If it is already gone, abort.
    const before = await pgvectorPresent(prisma);
    console.log(`pgvector BEFORE: ${before ? "PRESENT" : "MISSING"}`);
    if (!before) {
      console.error("✗ pgvector extension MISSING before apply — aborting, do not proceed.");
      process.exit(3);
    }

    // Apply the statements from the pending migration file.
    const sql = readFileSync(SQL_PATH, "utf8");
    
    // Split statements. Note that the DO block contains semicolons inside BEGIN/END,
    // so we split by custom regex or parse statements carefully.
    // The DO block has `DO $$ ... END $$;`. Let's handle it by extracting statements.
    const stmts: string[] = [];
    let current = "";
    let insideDollarQuotes = false;
    
    const lines = sql.split("\n");
    for (let line of lines) {
      if (line.trim().startsWith("--")) continue;
      if (line.includes("$$")) {
        insideDollarQuotes = !insideDollarQuotes;
      }
      current += line + "\n";
      if (!insideDollarQuotes && line.trim().endsWith(";")) {
        stmts.push(current.trim());
        current = "";
      }
    }
    if (current.trim().length > 0) {
      stmts.push(current.trim());
    }

    const filteredStmts = stmts.filter((s) => s.length > 0);

    for (const stmt of filteredStmts) {
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

    // GUARD: pgvector must STILL be present AFTER.
    const after = await pgvectorPresent(prisma);
    console.log(`pgvector AFTER:  ${after ? "PRESENT" : "MISSING"}`);
    if (!after) {
      console.error(
        "✗✗ pgvector MISSING after apply — this should be impossible. Investigate immediately.",
      );
      process.exit(4);
    }

    // Record as applied so `migrate deploy` never re-runs it (drift-safe).
    await prisma
      .$executeRawUnsafe(
        `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES (gen_random_uuid()::text, 'manual-apply-social-publish-queue-2026-06-23', NOW(), '${MIGRATION_NAME}', NULL, NULL, NOW(), 1)
         ON CONFLICT DO NOTHING`,
      )
      .then(() => console.log("  recorded in _prisma_migrations"))
      .catch((e) =>
        console.log(
          `  (skipped _prisma_migrations row: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"})`,
        ),
      );

    console.log(`\n✓ ${MIGRATION_NAME} applied · social_publish_queue table live · pgvector intact`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
