/**
 * Tool telemetry probe · v10.0.190
 *
 * Telemetry lives in BrainMemory rows (category="tool_telemetry",
 * key="tool:<toolName>"), aggregated atomically per tool. Each row's
 * metadata holds: totalCalls, successCount, failCount, lastErrors[],
 * lastCallAt, totalDurationMs.
 *
 * v10.0.179 (4h+ ago) made soft-fails count as failures instead of
 * successes. Any failPct > 0 on a tool that's been called since then
 * is a real broken integration.
 *
 * Usage: node --env-file=.env.local scripts/probe-tool-telemetry.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const rows = await prisma.brainMemory.findMany({
    where: {
      category: "tool_telemetry",
      deletedAt: null,
    },
    select: {
      key: true,
      seenCount: true,
      lastSeen: true,
      metadata: true,
    },
    orderBy: { lastSeen: "desc" },
  });

  const tools = rows.map((r) => {
    const m = (r.metadata ?? {});
    const total = Number(m.totalCalls ?? r.seenCount ?? 0);
    const fail = Number(m.failCount ?? 0);
    const ok = Number(m.successCount ?? 0);
    const totalMs = Number(m.totalDurationMs ?? 0);
    const lastErrors = Array.isArray(m.lastErrors) ? m.lastErrors : [];
    return {
      name: r.key.replace(/^tool:/, ""),
      total,
      ok,
      fail,
      failPct: total > 0 ? Math.round((fail / total) * 100) : 0,
      avgMs: total > 0 ? Math.round(totalMs / total) : 0,
      lastSeen: r.lastSeen,
      lastErr: lastErrors.length > 0 ? lastErrors[lastErrors.length - 1]?.message ?? null : null,
    };
  });

  const POST_FIX = new Date(Date.now() - 6 * 3600_000);
  const recent = tools.filter((t) => t.lastSeen >= POST_FIX);
  const broken = recent.filter((t) => t.failPct > 0).sort((a, b) => b.failPct - a.failPct);
  const healthy = recent.filter((t) => t.failPct === 0);
  const idle = tools.filter((t) => t.lastSeen < POST_FIX);

  console.log(`\n=== Tool telemetry probe ===`);
  console.log(`Active in last 6h: ${recent.length} tools`);
  console.log(`Idle (>6h): ${idle.length} tools`);
  console.log(`Total tracked: ${tools.length}\n`);

  if (broken.length > 0) {
    console.log("🔴 ACTIVE TOOLS WITH FAILURES (last 6h):");
    console.log("name".padEnd(28) + "total  fail%   fail   ok    avgMs  lastErr");
    console.log("-".repeat(100));
    for (const t of broken) {
      const errPreview = (t.lastErr ?? "").slice(0, 50);
      console.log(
        `${t.name.padEnd(28)}${String(t.total).padStart(5)}  ${String(t.failPct + "%").padStart(5)}  ${String(t.fail).padStart(5)}  ${String(t.ok).padStart(5)}  ${String(t.avgMs).padStart(6)}  ${errPreview}`,
      );
    }
  } else if (recent.length > 0) {
    console.log("🟢 No failing tools in last 6h.");
  } else {
    console.log("⚪ No tool activity in last 6h. v10.0.179 fix needs traffic to surface signal.");
  }

  console.log(`\n🟢 HEALTHY (active 6h, 100% success): ${healthy.length}`);
  if (healthy.length > 0 && healthy.length < 25) {
    console.log("  " + healthy.map((t) => `${t.name}(${t.total})`).join(", "));
  }

  // Top idle (haven't fired in days — could be dead code or just unused)
  if (idle.length > 0) {
    const oldest = idle.slice().sort((a, b) => a.lastSeen.getTime() - b.lastSeen.getTime()).slice(0, 5);
    console.log(`\n⚪ OLDEST IDLE (haven't fired recently):`);
    for (const t of oldest) {
      const days = Math.floor((Date.now() - t.lastSeen.getTime()) / 86400_000);
      console.log(`  ${t.name.padEnd(28)} last fired ${days}d ago · total=${t.total} · failPct=${t.failPct}%`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
