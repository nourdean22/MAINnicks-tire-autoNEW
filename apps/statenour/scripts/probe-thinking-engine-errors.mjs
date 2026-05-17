/**
 * Drill into thinking-engine 50% error rate over last 6h.
 * Show error_class breakdown + recent error messages.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });

const since = new Date(Date.now() - 6 * 3600_000);

console.log("\n=== thinking-engine 6h error drill ===\n");

const total = await prisma.agentTrace.count({ where: { label: "thinking-engine", createdAt: { gte: since } } });
const errs = await prisma.agentTrace.count({
  where: { label: "thinking-engine", createdAt: { gte: since }, errorClass: { not: null } },
});
console.log(`total=${total}  errs=${errs}  rate=${total > 0 ? Math.round((errs/total)*100) : 0}%\n`);

// Error class breakdown
const breakdown = await prisma.$queryRawUnsafe(`
  SELECT error_class::text AS ec, COUNT(*)::int AS n
  FROM agent_traces
  WHERE label = 'thinking-engine' AND error_class IS NOT NULL
    AND created_at >= NOW() - INTERVAL '6 hours'
  GROUP BY error_class ORDER BY n DESC
`);
console.log("Error classes:");
for (const r of breakdown) console.log(`  ${r.ec.padEnd(40)} ${r.n}`);

// Latest 5 error rows
const recent = await prisma.agentTrace.findMany({
  where: { label: "thinking-engine", errorClass: { not: null }, createdAt: { gte: since } },
  orderBy: { createdAt: "desc" },
  take: 5,
  select: { id: true, errorClass: true, errorMessage: true, model: true, provider: true, durationMs: true, createdAt: true },
});
console.log("\nRecent errors:");
for (const r of recent) {
  console.log(`  ${r.createdAt.toISOString()} · ${r.provider}/${r.model} · ${r.errorClass}`);
  if (r.errorMessage) console.log(`    msg: ${r.errorMessage.slice(0, 200)}`);
}

// Compare to prior 18h (12h-30h ago) for trend
const priorSince = new Date(Date.now() - 30 * 3600_000);
const priorEnd = new Date(Date.now() - 12 * 3600_000);
const priorTotal = await prisma.agentTrace.count({
  where: { label: "thinking-engine", createdAt: { gte: priorSince, lt: priorEnd } },
});
const priorErrs = await prisma.agentTrace.count({
  where: { label: "thinking-engine", errorClass: { not: null }, createdAt: { gte: priorSince, lt: priorEnd } },
});
const priorRate = priorTotal > 0 ? Math.round((priorErrs/priorTotal)*100) : 0;
console.log(`\nPrior 18h window (12h-30h ago): total=${priorTotal} errs=${priorErrs} rate=${priorRate}%`);
console.log(`Trend: ${total > 0 ? Math.round((errs/total)*100) : 0}% recent vs ${priorRate}% prior`);

await prisma.$disconnect();
