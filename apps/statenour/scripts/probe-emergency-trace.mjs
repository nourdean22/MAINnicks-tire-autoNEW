/**
 * Drill into the most recent provider_emergency agent_trace to find
 * the actual SDK error. The trace stores spans and notes — there
 * should be per-provider failure detail.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });

const recent = await prisma.agentTrace.findMany({
  where: { errorClass: "provider_emergency" },
  orderBy: { createdAt: "desc" },
  take: 3,
  select: {
    id: true,
    label: true,
    createdAt: true,
    durationMs: true,
    errorClass: true,
    errorMessage: true,
    provider: true,
    model: true,
    source: true,
    inputChars: true,
    outputChars: true,
    costCents: true,
    traceId: true,
    metadata: true,
  },
});

for (const t of recent) {
  console.log(`\n── trace ${t.id} · ${t.createdAt.toISOString()} · ${t.durationMs}ms ──`);
  console.log(`source=${t.source}  provider=${t.provider}  model=${t.model}`);
  console.log(`inputChars=${t.inputChars}  outputChars=${t.outputChars}  costCents=${t.costCents}`);
  console.log(`errorClass=${t.errorClass}`);
  console.log(`errorMessage:`, t.errorMessage?.slice(0, 500));
  // v10.0.212 · per-provider failure detail. Empty before that deploy.
  const failures = t.metadata?.providerFailures;
  if (Array.isArray(failures) && failures.length > 0) {
    console.log(`providerFailures (${failures.length}):`);
    for (const f of failures) {
      console.log(`  · ${f.provider.padEnd(10)} ${f.modelId?.padEnd(40)} ${f.failureClass?.padEnd(20)} ${f.durationMs}ms`);
      console.log(`    msg: ${f.message?.slice(0, 200)}`);
      if (f.bodySnippet) console.log(`    body: ${f.bodySnippet.slice(0, 200)}`);
    }
  } else {
    console.log(`providerFailures: (none — pre-v10.0.212 trace or success)`);
  }
}

await prisma.$disconnect();
