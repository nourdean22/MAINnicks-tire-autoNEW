/**
 * Unified health probe · v10.0.200
 *
 * Single command answers: "is statenour OK?" Runs all the targeted
 * probes in sequence and prints a compact severity-tagged report.
 *
 * Replaces having to remember 7 different scripts. Use this after
 * every deploy + on demand when something feels off.
 *
 * Usage: pnpm exec tsx scripts/health.ts
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

interface Finding {
  severity: "ok" | "info" | "warn" | "fail";
  topic: string;
  detail: string;
}

const findings: Finding[] = [];
const tag = (s: Finding["severity"]) => ({
  ok: "🟢",
  info: "⚪",
  warn: "🟡",
  fail: "🔴",
})[s];

async function check(topic: string, fn: () => Promise<Finding | null>) {
  try {
    const f = await fn();
    if (f) findings.push(f);
  } catch (err) {
    findings.push({
      severity: "fail",
      topic,
      detail: `probe error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ── Probes ───────────────────────────────────────────────────────

async function checkAgentTraceErrors() {
  const rows = await prisma.$queryRawUnsafe<Array<{ ec: string; n: number }>>(`
    SELECT error_class::text AS ec, COUNT(*)::int AS n
    FROM agent_traces
    WHERE error_class IS NOT NULL AND created_at >= NOW() - INTERVAL '24 hours'
    GROUP BY error_class ORDER BY n DESC LIMIT 10
  `);
  if (rows.length === 0) {
    return { severity: "ok", topic: "agent_traces", detail: "0 errors / 24h" } as Finding;
  }
  const total = rows.reduce((s, r) => s + Number(r.n), 0);
  const sev: Finding["severity"] = total > 50 ? "fail" : total > 10 ? "warn" : "info";
  const breakdown = rows.map((r) => `${r.ec}=${r.n}`).join(" · ");
  return { severity: sev, topic: "agent_traces", detail: `${total} errors / 24h · ${breakdown}` };
}

async function checkBrainPipeline() {
  const rows = await prisma.$queryRawUnsafe<Array<{ l: string; total: number; emerg: number }>>(`
    SELECT label::text AS l,
           COUNT(*)::int AS total,
           SUM(CASE WHEN error_class = 'provider_emergency' THEN 1 ELSE 0 END)::int AS emerg
    FROM agent_traces
    WHERE label IN ('ai-memory','thinking-engine','memory-consolidation')
      AND created_at >= NOW() - INTERVAL '24 hours'
    GROUP BY label
  `);
  if (rows.length === 0) {
    return { severity: "info", topic: "brain_pipeline", detail: "no calls / 24h" } as Finding;
  }
  const worst = rows
    .map((r) => ({ l: r.l, pct: r.total > 0 ? Math.round((Number(r.emerg) / Number(r.total)) * 100) : 0, total: Number(r.total) }))
    .sort((a, b) => b.pct - a.pct)[0];
  const sev: Finding["severity"] = worst.pct > 30 ? "fail" : worst.pct > 10 ? "warn" : "ok";
  const breakdown = rows.map((r) => `${r.l}=${r.emerg}/${r.total}`).join(" · ");
  return { severity: sev, topic: "brain_pipeline", detail: `worst=${worst.l}@${worst.pct}% · ${breakdown}` };
}

async function checkCronFailures() {
  const rows = await prisma.$queryRawUnsafe<Array<{ j: string; n: number }>>(`
    SELECT "jobName"::text AS j, COUNT(*)::int AS n
    FROM cron_job_logs
    WHERE status = 'failed' AND "createdAt" >= NOW() - INTERVAL '48 hours'
    GROUP BY "jobName" ORDER BY n DESC LIMIT 5
  `);
  if (rows.length === 0) {
    return { severity: "ok", topic: "cron_failures", detail: "0 failed / 48h" } as Finding;
  }
  const total = rows.reduce((s, r) => s + Number(r.n), 0);
  const sev: Finding["severity"] = total > 5 ? "warn" : "info";
  return { severity: sev, topic: "cron_failures", detail: `${total} failed / 48h · ${rows.map((r) => `${r.j}=${r.n}`).join(", ")}` };
}

async function checkVectorOrphans() {
  const total = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int AS n FROM vector_embeddings`,
  );
  const orphanMem = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
    SELECT COUNT(*)::int AS n
    FROM vector_embeddings ve
    LEFT JOIN brain_memories bm ON bm.id = ve."sourceId"
    WHERE ve."sourceType" = 'brain_memory'
      AND (bm.id IS NULL OR bm.deleted_at IS NOT NULL)
  `);
  const t = Number(total[0].n);
  const o = Number(orphanMem[0].n);
  const pct = t > 0 ? Math.round((o / t) * 100) : 0;
  const sev: Finding["severity"] = pct > 30 ? "warn" : "ok";
  return { severity: sev, topic: "vector_orphans", detail: `${o}/${t} orphans (${pct}%)` };
}

async function checkBrainMemorySize() {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: string; n: number }>>(`
    SELECT category::text AS c, COUNT(*)::int AS n
    FROM brain_memories
    WHERE deleted_at IS NULL
    GROUP BY category ORDER BY n DESC LIMIT 5
  `);
  return {
    severity: "info" as const,
    topic: "brain_memory_top5",
    detail: rows.map((r) => `${r.c}=${r.n}`).join(" · "),
  };
}

async function checkExtractedTables() {
  const tables = ["tool_telemetry", "tool_verb_ratios", "autonomous_events", "semantic_edges"];
  const counts: string[] = [];
  for (const t of tables) {
    try {
      const r = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      counts.push(`${t}=${r[0].n}`);
    } catch {
      counts.push(`${t}=err`);
    }
  }
  return {
    severity: "info" as const,
    topic: "extracted_tables",
    detail: counts.join(" · "),
  };
}

// checkDualWriteParity removed 2026-07-30: the legacy BrainMemory telemetry
// categories are dead (0 writes in 30d — Phase 3 of the extractions finished
// long ago), so "legacy writing but typed silent" can never occur again and
// the check was a permanently-green no-op.

async function main() {
  console.log("\n=== statenour health probe ===\n");

  await check("agent_traces", checkAgentTraceErrors);
  await check("brain_pipeline", checkBrainPipeline);
  await check("cron_failures", checkCronFailures);
  await check("vector_orphans", checkVectorOrphans);
  await check("brain_memory_top5", checkBrainMemorySize);
  await check("extracted_tables", checkExtractedTables);

  const order: Record<Finding["severity"], number> = { fail: 0, warn: 1, info: 2, ok: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  for (const f of findings) {
    console.log(`${tag(f.severity)} ${f.topic.padEnd(22)} ${f.detail}`);
  }

  const fails = findings.filter((f) => f.severity === "fail").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  console.log(`\nSummary: ${fails} fail · ${warns} warn · ${findings.length - fails - warns} ok/info`);
  process.exit(fails > 0 ? 1 : 0);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
