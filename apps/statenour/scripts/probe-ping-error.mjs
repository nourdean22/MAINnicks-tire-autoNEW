/**
 * Read recent ProviderPing rows to see what error_class is recorded
 * for OpenAI + Ollama failures. The cron does POST /chat/completions
 * which is different from my earlier /v1/models GET probe.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });

const recent = await prisma.providerPing.findMany({
  orderBy: { pingedAt: "desc" },
  take: 15,
  select: { provider: true, available: true, latencyMs: true, errorClass: true, pingedAt: true },
});

console.log("\n=== Recent provider pings (15 most recent) ===\n");
for (const p of recent) {
  const ok = p.available ? "🟢" : "🔴";
  console.log(`${p.pingedAt.toISOString()} · ${ok} ${p.provider.padEnd(10)} · ${p.latencyMs.toString().padStart(5)}ms · ${p.errorClass ?? "ok"}`);
}

// Group by provider, show distinct error_class values
const byProvider = await prisma.$queryRawUnsafe(`
  SELECT provider, error_class, COUNT(*)::int AS n
  FROM provider_pings
  WHERE pinged_at >= NOW() - INTERVAL '24 hours'
    AND NOT available
  GROUP BY provider, error_class
  ORDER BY provider, n DESC
`);
console.log("\n=== Failure classes by provider (24h) ===\n");
for (const r of byProvider) console.log(`  ${r.provider.padEnd(10)} ${(r.error_class ?? "(null)").padEnd(30)} ${r.n}`);

await prisma.$disconnect();
