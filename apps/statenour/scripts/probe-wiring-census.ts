/**
 * Wiring census + trust ladder — READ-ONLY prod probe (BDN-101/102).
 *
 * Runs both new read models against real data so the surfaces are
 * verified to report TRUTH, not merely to compile. A green unit test
 * over a synthetic fixture proves nothing about the producer.
 *
 * Run: pnpm exec tsx scripts/probe-wiring-census.ts
 */
import { buildWiringCensus } from "@/lib/observability/wiring-census";
import { buildTrustLadder } from "@/lib/ai/trust-ladder";
import { buildHomeDecisionMetrics } from "@/lib/observability/home-decision-metrics";
import { buildWisdomGateSpc, buildCalibrationReport } from "@/lib/brain/judgment-quality";
import { prisma } from "@/lib/prisma";

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").host || "(unparseable)";
  } catch {
    return "(unset or unparseable)";
  }
}

async function main(): Promise<void> {
  console.log(`DB host: ${dbHost()}`);

  const census = await buildWiringCensus();
  console.log(`\n── WIRING CENSUS · ${census.lanes.length} lanes ──`);
  for (const l of census.lanes) {
    console.log(`  [${l.status.padEnd(8)}] ${l.laneClass.padEnd(18)} ${l.id}`);
    console.log(`             ${l.detail}`);
  }
  const counts: Record<string, number> = {};
  for (const l of census.lanes) counts[l.status] = (counts[l.status] ?? 0) + 1;
  console.log("\n  status counts:", counts);

  // BDN-104/105/106 · the same discipline: read models get run against
  // PROD before they ship, because both defects found on 2026-08-12 were
  // invisible to green unit tests over fixtures.
  const home = await buildHomeDecisionMetrics(7);
  console.log(
    `\n── HOME DECISIONS (7d) ── total=${home.total} verdicts=${home.verdicts} resumes=${home.resumes} activeDays=${home.activeDays}`,
  );
  if (home.note) console.log(`  note: ${home.note}`);

  const spc = await buildWisdomGateSpc();
  console.log(
    `\n── WISDOM GATE (8wk) ── promoted=${spc.totals.promoted} gateRejected=${spc.totals.gateRejected} ` +
      `dupeSkipped=${spc.totals.dupeSkipped} failed=${spc.totals.failed} parked=${spc.totals.parked} ` +
      `total=${spc.totals.total} decided=${spc.decided} underSampled=${spc.underSampled}`,
  );

  const cal = await buildCalibrationReport();
  console.log(`\n── CONFIDENCE CALIBRATION ── resolved=${cal.totalResolved}`);
  for (const b of cal.bands) {
    console.log(
      `  ${b.band.padEnd(4)} resolved=${b.resolved} kept=${b.kept} unresolved=${b.unresolved} ` +
        `hitRate=${b.hitRate === null ? "n/a" : `${Math.round(b.hitRate * 100)}%`}`,
    );
  }
  if (cal.note) console.log(`  note: ${cal.note}`);

  const ladder = await buildTrustLadder();
  console.log(`\n── TRUST LADDER · ${ladder.windowDays}d · flag ${ladder.flagOn ? "ON" : "OFF"} ──`);
  for (const r of ladder.rows) {
    const rate = r.acceptanceRate === null ? "n/a" : `${Math.round(r.acceptanceRate * 100)}%`;
    console.log(
      `  ${r.actionType.padEnd(22)} decided=${String(r.decided).padStart(3)} accept=${rate.padStart(4)} ` +
        `allowlisted=${r.allowlisted} meetsBar=${r.meetsBar} wouldAuto=${r.wouldAutoExecute}`,
    );
  }
}

void main()
  .catch((err) => {
    console.error("probe failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
