/**
 * Smoke the /api/brain/insights aggregation queries against the
 * actual DB. Doesn't hit the route — runs the same SQL inline so
 * we know the deployed handler will return sensible data.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
const now = Date.now();
const week = 7 * 86400_000;
const recentSince = new Date(now - week);
const priorSince = new Date(now - 2 * week);

console.log("\n=== Brain insights aggregation smoke ===\n");

// 1. Anti-pattern sprint
const apRecent = await prisma.brainMemory.count({
  where: { category: "anti_pattern", deletedAt: null, createdAt: { gte: recentSince } },
});
const apPrior = await prisma.brainMemory.count({
  where: { category: "anti_pattern", deletedAt: null, createdAt: { gte: priorSince, lt: recentSince } },
});
console.log(`1. anti-patterns 7d=${apRecent} prior=${apPrior}`);

// 2. Category growth
const recentByCat = await prisma.$queryRawUnsafe(`
  SELECT category::text AS c, COUNT(*)::int AS n
  FROM brain_memories
  WHERE deleted_at IS NULL AND created_at >= NOW() - INTERVAL '7 days'
  GROUP BY category ORDER BY n DESC LIMIT 10
`);
console.log(`2. category growth · top 10 by recent count:`);
for (const r of recentByCat) console.log(`   ${r.c.padEnd(30)} ${r.n}`);

// 3. Reflection gap
const recentReflections = await prisma.reflection.findMany({
  where: { createdAt: { gte: new Date(now - 30 * 86400_000) } },
  orderBy: { createdAt: "desc" },
  take: 5,
  select: { createdAt: true, scope: true, category: true },
});
console.log(`3. reflections last 30d · ${recentReflections.length} found`);
for (const r of recentReflections) {
  console.log(`   ${r.createdAt.toISOString()} · ${r.scope} · ${r.category}`);
}

// 4. Decision velocity
const decRecent = await prisma.masteryDecision.count({ where: { createdAt: { gte: recentSince } } });
const decPrior = await prisma.masteryDecision.count({ where: { createdAt: { gte: priorSince, lt: recentSince } } });
console.log(`4. decisions 7d=${decRecent} prior=${decPrior}`);

// 6. Decision grade trend (v10.0.224)
const recentReviewed = await prisma.masteryDecision.count({
  where: { deletedAt: null, grade: { not: null }, updatedAt: { gte: recentSince } },
});
const priorReviewed = await prisma.masteryDecision.count({
  where: { deletedAt: null, grade: { not: null }, updatedAt: { gte: priorSince, lt: recentSince } },
});
console.log(`6. graded decisions · 7d=${recentReviewed} prior=${priorReviewed}`);

// 7. Cron failure trend (v10.0.224)
const recentCronFails = await prisma.cronJobLog.count({
  where: { status: { not: "success" }, createdAt: { gte: recentSince } },
});
const priorCronFails = await prisma.cronJobLog.count({
  where: { status: { not: "success" }, createdAt: { gte: priorSince, lt: recentSince } },
});
console.log(`7. cron failures · 7d=${recentCronFails} prior=${priorCronFails}`);

// 5. Domain clustering
const revisitsByDomain = await prisma.$queryRawUnsafe(`
  SELECT (metadata->>'domain')::text AS d, COUNT(*)::int AS n
  FROM brain_memories
  WHERE category = 'anti_pattern'
    AND deleted_at IS NULL
    AND metadata->>'lastRevisitedAt' IS NOT NULL
    AND (metadata->>'lastRevisitedAt')::timestamp >= NOW() - INTERVAL '7 days'
  GROUP BY metadata->>'domain'
  HAVING COUNT(*) >= 2
  ORDER BY n DESC
`);
console.log(`5. domain clustering · ${revisitsByDomain.length} clusters:`);
for (const r of revisitsByDomain) console.log(`   ${r.d ?? "(null)"} = ${r.n}`);

await prisma.$disconnect();
