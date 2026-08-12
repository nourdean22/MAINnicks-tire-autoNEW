/**
 * Brain-bus census — READ-ONLY probe. No writes.
 *
 * The 2026-08-12 "RETROFIT BUILD PASS" plan's thesis fact is "393 pending
 * events, zero consumers since late May 2026" — the exact pre-revival
 * snapshot quoted in config/crons.ts:474-480, fixed 2026-07-28 by the
 * brain-bus-drain cron (every 15 min via the worker). This probe reads
 * the CURRENT queue state so the gate verdict rests on live data, not on
 * either the plan's claim or the manifest's historical comment.
 *
 * Run: pnpm exec tsx scripts/probe-brain-bus-census.ts
 */
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

  const byStatus = await prisma.brainBusEvent.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  console.log("\nbrain_bus_events by status:");
  for (const s of byStatus) console.log(`  ${s.status}: ${s._count._all}`);

  const pending = await prisma.brainBusEvent.findMany({
    where: { status: "pending" },
    select: { topic: true, eventType: true, availableAt: true },
    orderBy: { availableAt: "asc" },
    take: 500,
  });
  if (pending.length > 0) {
    const byTopic: Record<string, number> = {};
    for (const p of pending) {
      const key = `${p.topic}.${p.eventType}`;
      byTopic[key] = (byTopic[key] ?? 0) + 1;
    }
    console.log(`\npending sample (${pending.length} oldest): by topic.eventType`, byTopic);
    console.log(`oldest pending availableAt: ${pending[0].availableAt.toISOString()}`);
  } else {
    console.log("\npending: none");
  }

  const lastProcessed = await prisma.brainBusEvent.findFirst({
    where: { status: { not: "pending" } },
    orderBy: { processedAt: "desc" },
    select: { status: true, topic: true, eventType: true, processedAt: true },
  });
  console.log(
    "\nmost recently processed:",
    lastProcessed
      ? `${lastProcessed.status} · ${lastProcessed.topic}.${lastProcessed.eventType} · ${lastProcessed.processedAt?.toISOString() ?? "(no timestamp)"}`
      : "none",
  );
}

void main()
  .catch((err) => {
    console.error("probe failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
