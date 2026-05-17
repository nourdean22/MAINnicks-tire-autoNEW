/**
 * Probe recent AgentTrace + SystemMetric for AI endpoints the operator
 * has flagged as potentially broken: plan-project, ai/tasks, plan-day.
 *
 * Usage: node --env-file=.env.local scripts/probe-ai-endpoint-health.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const SINCE_HOURS = 72;
const since = new Date(Date.now() - SINCE_HOURS * 3600_000);

async function probe() {
  // 1. AgentTrace rows for plan-project + plan-day + ai-tasks-generate
  const labels = [
    "plan-project:clarify",
    "plan-project:plan",
    "plan-project:milestones",
    "plan-project:learn",
    "plan-project:guide",
    "ai-tasks-generate",
    "plan-day",
  ];
  const traces = await prisma.agentTrace.findMany({
    where: { label: { in: labels }, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 100,
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

  console.log(`\n=== AgentTrace · last ${SINCE_HOURS}h · ${labels.length} labels ===`);
  const byLabel = new Map();
  for (const t of traces) {
    if (!byLabel.has(t.label)) byLabel.set(t.label, { ok: 0, err: 0, samples: [] });
    const bucket = byLabel.get(t.label);
    if (t.errorClass) bucket.err++;
    else bucket.ok++;
    bucket.samples.push(t);
  }

  for (const label of labels) {
    const bucket = byLabel.get(label);
    if (!bucket) {
      console.log(`  ${label.padEnd(28)} · NEVER FIRED`);
      continue;
    }
    const total = bucket.ok + bucket.err;
    const errPct = total > 0 ? Math.round((bucket.err / total) * 100) : 0;
    console.log(
      `  ${label.padEnd(28)} · ${total} runs · ${bucket.ok} ok · ${bucket.err} err (${errPct}%)`,
    );
    // Show last error if any
    const lastErr = bucket.samples.find((s) => s.errorClass);
    if (lastErr) {
      console.log(
        `    ↳ last err: ${lastErr.errorClass} · ${(lastErr.errorMessage || "").slice(0, 100)}`,
      );
    }
    // Show last success outputChars
    const lastOk = bucket.samples.find((s) => !s.errorClass);
    if (lastOk) {
      console.log(
        `    ↳ last ok:  provider=${lastOk.provider} · ${lastOk.outputChars}ch · ${lastOk.durationMs}ms`,
      );
    }
  }

  // 2. SystemMetric for any plan-project / ai-tasks errors
  const errors = await prisma.systemMetric.findMany({
    where: {
      metric: { in: ["error_log", "ai_error", "stream_error"] },
      createdAt: { gte: since },
      OR: [
        { source: { contains: "plan" } },
        { source: { contains: "tasks" } },
        { tags: { path: ["route"], string_contains: "plan" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { metric: true, source: true, tags: true, createdAt: true },
  });

  console.log(`\n=== SystemMetric errors (plan/tasks scope) · last ${SINCE_HOURS}h ===`);
  if (errors.length === 0) {
    console.log("  (none)");
  } else {
    for (const e of errors.slice(0, 10)) {
      console.log(
        `  ${e.createdAt.toISOString()} · ${e.metric} · ${e.source} · ${JSON.stringify(e.tags).slice(0, 120)}`,
      );
    }
  }
}

probe()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
