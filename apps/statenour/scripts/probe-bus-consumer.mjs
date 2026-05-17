/**
 * Find the bus consumer cron + see when it last ran.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });

// 1. Recent bus-related cron jobs
const buswords = ['bus', 'brain-bus', 'consumer', 'process-bus', 'brain_bus'];
const recent = await prisma.$queryRawUnsafe(`
  SELECT "jobName"::text AS j,
         status::text AS s,
         "createdAt",
         duration AS dur
  FROM cron_job_logs
  WHERE "createdAt" >= NOW() - INTERVAL '6 hours'
    AND ("jobName" ILIKE '%bus%' OR "jobName" ILIKE '%consumer%' OR "jobName" ILIKE '%process%' OR "jobName" ILIKE '%mega%')
  ORDER BY "createdAt" DESC
  LIMIT 30
`);

console.log("\n=== Bus / consumer / mega cron jobs (last 6h) ===\n");
for (const r of recent) {
  console.log(`${r.createdAt.toISOString()} · ${r.j.padEnd(40)} · ${r.s.padEnd(10)} · ${r.dur ?? '?'}ms`);
}
console.log(`\nFound ${recent.length} matching jobs in 6h.`);

// 2. Pending bus events count + age
const pending = await prisma.$queryRawUnsafe(`
  SELECT COUNT(*)::int AS n, MIN(created_at) AS oldest, MAX(created_at) AS newest
  FROM brain_bus_events
  WHERE status = 'pending'
`);
const p = pending[0];
console.log(`\nPending bus events: ${p.n}`);
if (p.n > 0) {
  console.log(`  oldest: ${p.oldest?.toISOString()}`);
  console.log(`  newest: ${p.newest?.toISOString()}`);
  const ageMin = Math.round((Date.now() - new Date(p.oldest).getTime()) / 60_000);
  console.log(`  oldest is ${ageMin} min old`);
}

// 3. By status
const byStatus = await prisma.$queryRawUnsafe(`
  SELECT status::text AS s, COUNT(*)::int AS n
  FROM brain_bus_events
  WHERE created_at >= NOW() - INTERVAL '6 hours'
  GROUP BY status
`);
console.log(`\nBus events last 6h by status:`);
for (const r of byStatus) console.log(`  ${r.s.padEnd(20)} ${r.n}`);

// 4. All distinct cron job names today
const allJobs = await prisma.$queryRawUnsafe(`
  SELECT "jobName"::text AS j, COUNT(*)::int AS n, MAX("createdAt") AS last
  FROM cron_job_logs
  WHERE "createdAt" >= NOW() - INTERVAL '6 hours'
  GROUP BY "jobName"
  ORDER BY last DESC
`);
console.log(`\nAll cron jobs in 6h (sorted by recency):`);
for (const r of allJobs) {
  const ago = Math.round((Date.now() - new Date(r.last).getTime()) / 60_000);
  console.log(`  ${ago.toString().padStart(4)}m ago · ${r.j.padEnd(40)} · ${r.n}× runs`);
}

await prisma.$disconnect();
