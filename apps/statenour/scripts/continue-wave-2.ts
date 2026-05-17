// Continue-wave part 2: pick up where part 1 aborted
//   3. Resolve stale alert rows (correct column casing)
//   4. Run a real semantic search query
//   5. AI cost drilldown 7d
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
    // Discover brain_memories column naming first
    const cols = await prisma.$queryRawUnsafe<
      Array<{ column_name: string }>
    >(
      "SELECT column_name::text FROM information_schema.columns WHERE table_name='brain_memories' AND column_name IN ('createdAt','created_at','last_seen','lastSeen')",
    );
    console.log("brain_memories cols:", cols);

    // ─────────────────────────────────────────────────────────────
    // 3 · Stale alert cleanup using prisma.brainMemory (lets prisma
    // handle the column-name translation)
    // ─────────────────────────────────────────────────────────────
    console.log("\n=== 3 · stale alert cleanup ===");
    const staleAlerts = await prisma.brainMemory.findMany({
      where: {
        category: { in: ["schema_drift_alert", "brain_bus_alert"] },
        createdAt: { lt: new Date(Date.now() - 6 * 3600_000) },
      },
      select: { id: true, category: true, createdAt: true },
    });
    console.log(`  found ${staleAlerts.length} stale alert rows`);
    if (staleAlerts.length > 0) {
      const ids = staleAlerts.map((r) => r.id);
      const updated = await prisma.brainMemory.updateMany({
        where: { id: { in: ids } },
        data: {
          confidence: 0.05,
          source: "auto-resolved-by-fix-wave",
          lastSeen: new Date(),
        },
      });
      console.log(`  decayed: ${updated.count} rows confidence → 0.05`);
    }

    // ─────────────────────────────────────────────────────────────
    // 4 · End-to-end semantic search
    // ─────────────────────────────────────────────────────────────
    console.log("\n=== 4 · semantic search e2e ===");
    const seed = await prisma.$queryRawUnsafe<
      Array<{ embedding_vec: string; content: string }>
    >(
      `SELECT embedding_vec::text, content
       FROM vector_embeddings
       WHERE embedding_vec IS NOT NULL AND length(content) > 50
       LIMIT 1`,
    );
    if (seed.length > 0) {
      const t0 = Date.now();
      const knn = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          sourceType: string;
          content: string;
          distance: number;
        }>
      >(
        `SELECT v.id::text, v."sourceType"::text,
                substring(v.content, 1, 80)::text AS content,
                (v.embedding_vec <=> '${seed[0].embedding_vec}'::vector) AS distance
         FROM vector_embeddings v
         WHERE v.embedding_vec IS NOT NULL
         ORDER BY v.embedding_vec <=> '${seed[0].embedding_vec}'::vector
         LIMIT 5`,
      );
      const elapsed = Date.now() - t0;
      console.log(`  query seed: "${seed[0].content.slice(0, 60).replace(/\s+/g, " ")}..."`);
      console.log(`  KNN top-5 across ${6916} vectorized rows: ${elapsed}ms`);
      knn.forEach((k, i) =>
        console.log(
          `    ${i + 1}. [${k.sourceType}] dist=${k.distance.toFixed(4)} · ${k.content.replace(/\s+/g, " ")}...`,
        ),
      );

      // Run a SECOND query with a different seed for variance
      const seed2 = await prisma.$queryRawUnsafe<
        Array<{ embedding_vec: string; content: string }>
      >(
        `SELECT embedding_vec::text, content
         FROM vector_embeddings
         WHERE embedding_vec IS NOT NULL AND length(content) > 50
         OFFSET 100 LIMIT 1`,
      );
      if (seed2.length > 0) {
        const t1 = Date.now();
        await prisma.$queryRawUnsafe(
          `SELECT v.id::text FROM vector_embeddings v
           WHERE v.embedding_vec IS NOT NULL
           ORDER BY v.embedding_vec <=> '${seed2[0].embedding_vec}'::vector
           LIMIT 5`,
        );
        console.log(`  second query (different seed): ${Date.now() - t1}ms`);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 5 · AI cost drilldown 7d
    // ─────────────────────────────────────────────────────────────
    console.log("\n=== 5 · AI cost 7d ===");
    // Discover ai_generations column naming
    const aiCols = await prisma.$queryRawUnsafe<
      Array<{ column_name: string }>
    >(
      "SELECT column_name::text FROM information_schema.columns WHERE table_name='ai_generations' ORDER BY ordinal_position LIMIT 30",
    );
    console.log(
      "  ai_generations cols:",
      aiCols.map((c) => c.column_name).join(", "),
    );

    // Use prisma client to handle naming
    const since = new Date(Date.now() - 7 * 86400_000);
    const callsByModel = await prisma.aiGeneration.groupBy({
      by: ["model"],
      where: { createdAt: { gte: since } },
      _count: { id: true },
      _sum: { costCents: true, durationMs: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    });
    console.log("  top models 7d:");
    callsByModel.forEach((m) => {
      const calls = m._count.id;
      const cents = m._sum.costCents ?? 0;
      const totalMs = m._sum.durationMs ?? 0;
      const avgMs = calls > 0 ? Math.round(totalMs / calls) : 0;
      console.log(
        `    ${(m.model ?? "unknown").padEnd(40)} calls=${calls.toString().padStart(4)} cost=${cents}¢ avg=${avgMs}ms`,
      );
    });

    const totalCost = callsByModel.reduce(
      (s, m) => s + (m._sum.costCents ?? 0),
      0,
    );
    const totalCalls = callsByModel.reduce((s, m) => s + m._count.id, 0);
    console.log(
      `\n  7d total: ${totalCalls} calls · ${totalCost}¢ · avg ${
        totalCalls > 0 ? (totalCost / totalCalls).toFixed(2) : 0
      }¢/call`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
