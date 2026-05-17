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
    const ext = await prisma.$queryRawUnsafe<
      Array<{ extname: string; extversion: string }>
    >(
      "SELECT extname::text, extversion::text FROM pg_extension WHERE extname='vector'",
    );
    console.log("vector extension:", ext);

    const cnt = await prisma.$queryRawUnsafe<
      Array<{ total: number; with_vec: number }>
    >(
      "SELECT COUNT(*)::int AS total, COUNT(embedding_vec)::int AS with_vec FROM vector_embeddings",
    );
    console.log("vector_embeddings counts:", cnt);

    const colInfo = await prisma.$queryRawUnsafe<
      Array<{ column_name: string; data_type: string; udt_name: string }>
    >(
      "SELECT column_name::text, data_type::text, udt_name::text FROM information_schema.columns WHERE table_name='vector_embeddings' AND column_name IN ('embedding','embedding_vec')",
    );
    console.log("columns:", colInfo);

    const dbInfo = await prisma.$queryRawUnsafe<
      Array<{ db: string; usr: string }>
    >("SELECT current_database()::text AS db, current_user::text AS usr");
    console.log("connection:", dbInfo);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
