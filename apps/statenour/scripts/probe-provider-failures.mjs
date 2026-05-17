/**
 * Probe SystemMetric / structured logs for provider.failed entries
 * to find WHY plan-project hits emergency fallback.
 *
 * Usage: node --env-file=.env.local scripts/probe-provider-failures.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const since = new Date(Date.now() - 72 * 3600_000);

try {
  // 1. Failed AgentTrace rows for ANY label in the last 72h
  const failed = await prisma.agentTrace.findMany({
    where: {
      createdAt: { gte: since },
      OR: [
        { errorClass: { not: null } },
        { provider: "none" },
        { provider: "emergency" },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      label: true,
      provider: true,
      durationMs: true,
      outputChars: true,
      errorClass: true,
      errorMessage: true,
      createdAt: true,
    },
  });

  console.log(`\n=== Failed/emergency AgentTrace rows · last 72h ===`);
  console.log(`Total: ${failed.length}\n`);
  const byLabel = new Map();
  for (const r of failed) {
    const k = r.label;
    if (!byLabel.has(k)) byLabel.set(k, []);
    byLabel.get(k).push(r);
  }
  for (const [label, rows] of byLabel) {
    console.log(`${label.padEnd(28)} · ${rows.length} fail(s)`);
    const sample = rows[0];
    console.log(
      `  ↳ provider=${sample.provider} · ${sample.durationMs}ms · ${sample.outputChars}ch · errClass=${sample.errorClass}`,
    );
    if (sample.errorMessage) {
      console.log(`  ↳ msg: ${sample.errorMessage.slice(0, 200)}`);
    }
  }

  // 2. SystemMetric for provider failures
  const providerErrors = await prisma.systemMetric.findMany({
    where: {
      createdAt: { gte: since },
      OR: [
        { metric: "provider.failed" },
        { metric: "provider.all_failed" },
        { metric: "ai.error" },
        { metric: "error_log" },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { metric: true, value: true, source: true, tags: true, createdAt: true },
  });

  console.log(`\n=== SystemMetric provider failures · last 72h ===`);
  console.log(`Total: ${providerErrors.length}\n`);
  for (const e of providerErrors.slice(0, 15)) {
    console.log(
      `${e.createdAt.toISOString()} · ${e.metric} · ${e.source} · ${JSON.stringify(e.tags).slice(0, 200)}`,
    );
  }

  // 3. plan-project specific traces (recent 10 successful or failed)
  const planTraces = await prisma.agentTrace.findMany({
    where: {
      label: { startsWith: "plan-project" },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      label: true,
      provider: true,
      model: true,
      durationMs: true,
      outputChars: true,
      errorClass: true,
      errorMessage: true,
      createdAt: true,
      metadata: true,
    },
  });

  console.log(`\n=== plan-project traces · last 72h ===`);
  console.log(`Total: ${planTraces.length}\n`);
  for (const t of planTraces) {
    console.log(
      `${t.createdAt.toISOString()} · ${t.label} · ${t.provider}/${t.model} · ${t.durationMs}ms · ${t.outputChars}ch · err=${t.errorClass || "-"}`,
    );
  }
} finally {
  await prisma.$disconnect();
}
