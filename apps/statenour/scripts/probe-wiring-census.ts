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
