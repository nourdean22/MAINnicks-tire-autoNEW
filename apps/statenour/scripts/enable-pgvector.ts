// Enable pgvector extension on the connected Postgres + verify the
// vector type is available afterward. Run with:
//   pnpm exec tsx scripts/enable-pgvector.ts
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
    console.log("Creating pgvector extension...");
    await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector");
    console.log("OK — extension created (or already existed).");

    const exts = await prisma.$queryRawUnsafe<
      Array<{ extname: string; extversion: string }>
    >(
      "SELECT extname::text, extversion::text FROM pg_extension WHERE extname='vector'",
    );
    if (exts.length === 0) {
      console.error("WARN — vector extension not visible after create.");
      process.exit(2);
    }
    console.log(
      `vector extension active · version ${exts[0].extversion}`,
    );

    const probe = await prisma.$queryRawUnsafe<
      Array<{ ok: number }>
    >(
      "SELECT 1 AS ok WHERE '[1,2,3]'::vector(3) <=> '[1,2,3]'::vector(3) = 0",
    );
    console.log(
      probe.length === 1
        ? "vector ops verified (cosine distance works)"
        : "vector ops returned unexpected shape",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
