/**
 * Tool catalog usage probe · v10.0.206
 *
 * Reads tool_telemetry (post v10.0.179 honesty fix) + ToolTelemetry
 * dual-write table + AgentTrace toolCalls field to surface which
 * tools actually carry load vs which are dead weight.
 *
 * Output: a ranked list with totalCalls and "candidate to retire?"
 * flag. Caller decides which to mark `mode: "retired"` in catalog.
 *
 * Usage: node --env-file=.env.local scripts/probe-tool-usage.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // 1. Total catalog size (load via prisma to avoid coupling to runtime)
  const catalogJson = await prisma.$queryRawUnsafe(
    `SELECT pg_relation_size('tool_telemetry')::bigint AS sz`,
  );
  const catalogPath = "lib/ai/tools/catalog.ts";
  // (We'll just read the catalog count via filesystem grep externally;
  //  this script focuses on usage data.)

  // 2. Tools that ever fired (per legacy BrainMemory tool_telemetry rows
  //    + new ToolTelemetry table)
  const legacyRows = await prisma.brainMemory.findMany({
    where: { category: "tool_telemetry", deletedAt: null },
    select: { key: true, seenCount: true, lastSeen: true, metadata: true },
    orderBy: { seenCount: "desc" },
  });

  const newRows = await prisma.toolTelemetry.findMany({
    select: {
      toolName: true,
      totalCalls: true,
      successCount: true,
      failCount: true,
      lastCallAt: true,
    },
    orderBy: { totalCalls: "desc" },
  });

  // Merge into a single map keyed by tool name
  const merged = new Map();

  for (const r of legacyRows) {
    const name = r.key.replace(/^tool:/, "");
    const meta = (r.metadata ?? {});
    merged.set(name, {
      name,
      totalCalls: Number(meta.totalCalls ?? r.seenCount ?? 0),
      successCount: Number(meta.successCount ?? 0),
      failCount: Number(meta.failCount ?? 0),
      lastCallAt: r.lastSeen,
    });
  }
  for (const r of newRows) {
    // Newer table wins if both have data
    merged.set(r.toolName, {
      name: r.toolName,
      totalCalls: r.totalCalls,
      successCount: r.successCount,
      failCount: r.failCount,
      lastCallAt: r.lastCallAt,
    });
  }

  const sorted = [...merged.values()].sort((a, b) => b.totalCalls - a.totalCalls);

  console.log(`\n=== Tool usage probe (all-time) ===`);
  console.log(`Tools with telemetry rows: ${sorted.length}`);
  console.log(`Tools that have NEVER fired (catalog total - sorted.length) ≈ 113 - ${sorted.length} = ${113 - sorted.length}`);
  console.log("");

  console.log("Top 20 by call volume:");
  console.log("name".padEnd(28) + "calls   fail%   last");
  console.log("-".repeat(70));
  for (const t of sorted.slice(0, 20)) {
    const pct = t.totalCalls > 0 ? Math.round((t.failCount / t.totalCalls) * 100) : 0;
    const last = t.lastCallAt ? new Date(t.lastCallAt).toISOString().slice(0, 10) : "-";
    console.log(
      `${t.name.padEnd(28)}${String(t.totalCalls).padStart(5)}  ${String(pct + "%").padStart(5)}  ${last}`,
    );
  }

  // Tools that fired only once (likely warmup or one-off)
  const oneOffs = sorted.filter((t) => t.totalCalls === 1);
  if (oneOffs.length > 0) {
    console.log(`\n${oneOffs.length} tools fired EXACTLY ONCE — candidates for retirement:`);
    for (const t of oneOffs.slice(0, 10)) {
      console.log(`  ${t.name}`);
    }
    if (oneOffs.length > 10) console.log(`  ...+${oneOffs.length - 10} more`);
  }

  // Tools that haven't fired in >60d
  const stale60d = sorted.filter(
    (t) => t.lastCallAt && Date.now() - new Date(t.lastCallAt).getTime() > 60 * 86400_000,
  );
  if (stale60d.length > 0) {
    console.log(`\n${stale60d.length} tools last fired >60 days ago:`);
    for (const t of stale60d.slice(0, 10)) {
      const d = Math.floor((Date.now() - new Date(t.lastCallAt).getTime()) / 86400_000);
      console.log(`  ${t.name.padEnd(28)} ${d}d ago · ${t.totalCalls} total calls`);
    }
  }

  // Recommendation
  console.log(`\n=== Recommendation ===`);
  const liveTools = sorted.filter((t) => t.totalCalls >= 5).length;
  console.log(`  ${liveTools} tools have >= 5 historical calls (call them "live")`);
  console.log(`  ${sorted.length - liveTools} tools have <5 calls (review for retirement)`);
  console.log(`  ${113 - sorted.length} tools have NEVER been called (almost certainly retire)`);
  console.log(`\n  Estimated catalog reduction if we retire <5-call + never-called:`);
  console.log(`    ${liveTools} live · ${113 - liveTools} candidates · ${Math.round((1 - liveTools / 113) * 100)}% reduction`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
