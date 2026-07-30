/**
 * Dual-write parity probe · v10.0.206
 *
 * Compares row counts between the 6 extracted typed tables and
 * their legacy BrainMemory categories. Output drives the Phase 2
 * cutover decision: when the typed table catches up to legacy
 * row count (or surpasses it on new writes), reads can flip
 * safely.
 *
 * Pre-cutover invariants:
 *   · Legacy count should be NON-DECREASING (no one writing to BM
 *     under the new domain except the dual-write itself)
 *   · Typed count should grow at the SAME rate as legacy from
 *     v10.0.194-203 ship dates
 *   · For domains shipped earlier (tool_telemetry · v10.0.194), the
 *     gap should be smaller than for the most recent (tool_embedding
 *     · v10.0.203)
 *
 * Usage: node --env-file=.env.local scripts/probe-dual-write-parity.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const PAIRS = [
  { domain: "tool_telemetry", legacyCat: "tool_telemetry", newTable: "tool_telemetry", since: "v10.0.194" },
  { domain: "telemetry_tool_verb", legacyCat: "telemetry_tool_verb", newTable: "tool_verb_ratios", since: "v10.0.197" },
  { domain: "autonomous_event", legacyCat: "autonomous_event", newTable: "autonomous_events", since: "v10.0.198" },
  { domain: "semantic_edge", legacyCat: "semantic_edge", newTable: "semantic_edges", since: "v10.0.198" },
  { domain: "tool_embedding", legacyCat: "tool_embedding", newTable: null, since: "v10.0.203" }, // VectorEmbedding sourceType
];

async function main() {
  console.log("\n=== Dual-write parity probe ===\n");
  console.log("domain".padEnd(22) + "legacy(+24h)".padStart(18) + "typed(+24h)".padStart(18) + "gap".padStart(8) + "  status / since");
  console.log("-".repeat(110));

  // Probe the last 24h to detect ACTIVE writes vs stale data.
  // The dual-write check is meaningful only when legacy is still
  // receiving writes — if both are quiet, we just have no signal.
  const since = new Date(Date.now() - 24 * 3600_000);

  for (const pair of PAIRS) {
    const legacyTotal = await prisma.brainMemory.count({
      where: { category: pair.legacyCat, deletedAt: null },
    });
    const legacyRecent = await prisma.brainMemory.count({
      where: { category: pair.legacyCat, deletedAt: null, createdAt: { gte: since } },
    });

    let typedTotal = 0;
    let typedRecent = 0;
    if (pair.newTable === "tool_telemetry") {
      typedTotal = await prisma.toolTelemetry.count();
      typedRecent = await prisma.toolTelemetry.count({ where: { createdAt: { gte: since } } });
    } else if (pair.newTable === "tool_verb_ratios") {
      typedTotal = await prisma.toolVerbRatio.count();
      typedRecent = await prisma.toolVerbRatio.count({ where: { createdAt: { gte: since } } });
    } else if (pair.newTable === "autonomous_events") {
      typedTotal = await prisma.autonomousEvent.count();
      typedRecent = await prisma.autonomousEvent.count({ where: { firedAt: { gte: since } } });
    } else if (pair.newTable === "semantic_edges") {
      typedTotal = await prisma.semanticEdge.count();
      typedRecent = await prisma.semanticEdge.count({ where: { createdAt: { gte: since } } });
    } else if (pair.domain === "tool_embedding") {
      typedTotal = await prisma.vectorEmbedding.count({ where: { sourceType: "tool_catalog" } });
      typedRecent = await prisma.vectorEmbedding.count({
        where: { sourceType: "tool_catalog", createdAt: { gte: since } },
      });
    }

    const gap = legacyTotal - typedTotal;
    let status;
    if (legacyTotal === 0 && typedTotal === 0) status = "⚪ both empty";
    else if (legacyRecent === 0 && typedRecent === 0) status = "⚪ inactive (no 24h writes)";
    else if (legacyRecent > 0 && typedRecent === 0) status = "🔴 LEGACY writing · TYPED silent";
    else if (legacyRecent === 0 && typedRecent > 0) status = "🟢 typed-only writes (cutover ready)";
    else if (typedRecent >= legacyRecent) status = `🟢 dual-write OK (${typedRecent}↔${legacyRecent} 24h)`;
    else status = `🟡 typed lagging (${typedRecent}/${legacyRecent} 24h)`;

    console.log(
      `${pair.domain.padEnd(22)}${String(legacyTotal).padStart(10)} (+${String(legacyRecent).padStart(3)}24h)${String(typedTotal).padStart(8)} (+${String(typedRecent).padStart(3)}24h)${String(gap).padStart(8)}  ${status}  ${pair.since}`,
    );
  }

  console.log(`\nReadiness gates for Phase 2 cutover (per domain):`);
  console.log(`  · gap === 0 OR typed > legacy (typed has caught up)`);
  console.log(`  · 24h+ of dual-write data confirms shape parity`);
  console.log(`  · No errors in last 24h on the dual-write path (check log warnings)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
