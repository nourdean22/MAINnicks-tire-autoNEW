// Apply the 3 HIGH-severity schema drift items the v8.x migrations
// were SUPPOSED to land but never did:
//
//   1. chat_messages.searchable_tsv — v7.6 generated tsvector for FTS
//   2. autonomous_actions_idempotency_key_uniq — v7.7 partial unique
//   3. entity_audits_idempotency_key_uniq — v8.0 partial unique
//
// Each statement is IF NOT EXISTS so re-running is safe.
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
    console.log("[1/3] chat_messages.searchable_tsv (generated tsvector for FTS)...");
    // Generated column referencing content. Postgres requires immutable
    // function for generated cols — to_tsvector('english', ...) IS
    // immutable when the config name is a literal string.
    const tsvCheck = await prisma.$queryRawUnsafe<
      Array<{ has: boolean }>
    >(
      "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='searchable_tsv') AS has",
    );
    if (tsvCheck[0].has) {
      console.log("  already exists");
    } else {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE chat_messages
         ADD COLUMN IF NOT EXISTS searchable_tsv tsvector
         GENERATED ALWAYS AS (
           to_tsvector('english', coalesce(content, ''))
         ) STORED`,
      );
      console.log("  added · generated tsvector(content) STORED");
    }
    // GIN index for fast FTS lookups
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS chat_messages_searchable_tsv_idx
       ON chat_messages USING GIN (searchable_tsv)`,
    );
    console.log("  GIN index ensured");

    console.log("\n[2/3] autonomous_actions_idempotency_key_uniq...");
    const idemCheck1 = await prisma.$queryRawUnsafe<
      Array<{ has: boolean }>
    >(
      "SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='autonomous_actions_idempotency_key_uniq') AS has",
    );
    if (idemCheck1[0].has) {
      console.log("  already exists");
    } else {
      // Verify the column exists first
      const colCheck1 = await prisma.$queryRawUnsafe<
        Array<{ has: boolean }>
      >(
        "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='autonomous_actions' AND column_name='idempotency_key') AS has",
      );
      if (!colCheck1[0].has) {
        await prisma.$executeRawUnsafe(
          "ALTER TABLE autonomous_actions ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64)",
        );
        console.log("  added missing idempotency_key column");
      }
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS autonomous_actions_idempotency_key_uniq
         ON autonomous_actions(idempotency_key)
         WHERE idempotency_key IS NOT NULL`,
      );
      console.log("  partial unique index created");
    }

    console.log("\n[3/3] entity_audits_idempotency_key_uniq...");
    const idemCheck2 = await prisma.$queryRawUnsafe<
      Array<{ has: boolean }>
    >(
      "SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='entity_audits_idempotency_key_uniq') AS has",
    );
    if (idemCheck2[0].has) {
      console.log("  already exists");
    } else {
      const colCheck2 = await prisma.$queryRawUnsafe<
        Array<{ has: boolean }>
      >(
        "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='entity_audits' AND column_name='idempotency_key') AS has",
      );
      if (!colCheck2[0].has) {
        await prisma.$executeRawUnsafe(
          "ALTER TABLE entity_audits ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64)",
        );
        console.log("  added missing idempotency_key column");
      }
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS entity_audits_idempotency_key_uniq
         ON entity_audits(idempotency_key)
         WHERE idempotency_key IS NOT NULL`,
      );
      console.log("  partial unique index created");
    }

    console.log("\n=== verify ===");
    const verify = await prisma.$queryRawUnsafe<
      Array<{ check: string; ok: boolean }>
    >(
      `SELECT 'chat_messages.searchable_tsv' AS check,
              EXISTS(SELECT 1 FROM information_schema.columns
                     WHERE table_name='chat_messages' AND column_name='searchable_tsv') AS ok
       UNION ALL
       SELECT 'autonomous_actions_idempotency_key_uniq',
              EXISTS(SELECT 1 FROM pg_indexes
                     WHERE indexname='autonomous_actions_idempotency_key_uniq')
       UNION ALL
       SELECT 'entity_audits_idempotency_key_uniq',
              EXISTS(SELECT 1 FROM pg_indexes
                     WHERE indexname='entity_audits_idempotency_key_uniq')`,
    );
    verify.forEach((v) =>
      console.log(`  ${v.ok ? "✓" : "✗"} ${v.check}`),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
