/**
 * Force-fire one autonomous.fired event by publishing directly to the
 * brain_bus_events table. The polling consumer will pick it up and the
 * v10.0.210 dual-write handler will run in production context. We then
 * immediately query AutonomousEvent + the bus row's lastError to see
 * exactly what's failing.
 *
 * Bypasses the 15-min cron schedule so we don't have to wait.
 *
 * Usage: node --env-file=.env.local scripts/force-fire-autonomous.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });

const probeId = `probe-force-${Date.now()}`;
console.log(`\n=== Force-fire autonomous.fired · probe=${probeId} ===\n`);

// 1. Publish a synthetic event directly to the bus.
// The brain-bus polling consumer will dispatch it through the registered
// handler, exactly the way the autonomous engine does in production.
const event = await prisma.brainBusEvent.create({
  data: {
    topic: "autonomous.fired",
    eventType: "autonomous.rule_executed",
    payload: {
      ruleName: "probe-rule-force-fire",
      actionType: "test",
      targetType: "probe",
      targetId: null,
      result: "success",
      idempotencyKey: probeId,
    },
    dedupeKey: probeId,
    status: "pending",
  },
});
console.log(`✅ published event id=${event.id} dedupeKey=${probeId}`);

// 2. Poll the event row + the typed table for up to 90s.
const beforeTyped = await prisma.autonomousEvent.count();
const beforeLegacy = await prisma.brainMemory.count({ where: { category: "autonomous_event", deletedAt: null } });
console.log(`baseline: AutonomousEvent=${beforeTyped} brainMemory(autonomous_event)=${beforeLegacy}`);

let processed = false;
for (let i = 0; i < 80; i++) {  // 80 × 3s = 240s = 4 min · backfill runs every ~2 min
  await new Promise(r => setTimeout(r, 3000));
  const row = await prisma.brainBusEvent.findUnique({
    where: { id: event.id },
    select: { status: true, processedAt: true, attempts: true, lastError: true },
  });
  console.log(`poll t=${(i+1)*3}s · status=${row.status} · processed=${!!row.processedAt} · attempts=${row.attempts} · lastError=${row.lastError?.slice(0,200) ?? "null"}`);
  if (row.status === "done" || row.status === "failed_terminal") {
    processed = true;
    break;
  }
}

if (!processed) {
  console.log("\n🔴 event NEVER processed in 90s — bus consumer is not running or polling stalled");
} else {
  // 3. Check whether typed + legacy both got a new row.
  const afterTyped = await prisma.autonomousEvent.count();
  const afterTypedByKey = await prisma.autonomousEvent.findUnique({ where: { eventId: probeId.slice(0, 80) } });
  const afterLegacyByKey = await prisma.brainMemory.findUnique({
    where: { category_key: { category: "autonomous_event", key: probeId } },
  });
  const afterLegacy = await prisma.brainMemory.count({ where: { category: "autonomous_event", deletedAt: null } });

  console.log(`\nAfter processing:`);
  console.log(`  AutonomousEvent  count=${afterTyped} (delta ${afterTyped - beforeTyped})`);
  console.log(`  AutonomousEvent  byEventId=${afterTypedByKey ? "FOUND" : "NOT FOUND"}`);
  console.log(`  BrainMemory      count=${afterLegacy} (delta ${afterLegacy - beforeLegacy})`);
  console.log(`  BrainMemory      byKey=${afterLegacyByKey ? "FOUND" : "NOT FOUND"}`);

  if (!afterTypedByKey && afterLegacyByKey) {
    console.log("\n🔴 CONFIRMED: legacy write succeeded, typed write SILENTLY DROPPED");
    console.log("   Watch Vercel runtime logs for 'autonomous_event_typed_write_failed' in next ~30s");
  } else if (afterTypedByKey && afterLegacyByKey) {
    console.log("\n🟢 Both writes succeeded — handler is healthy");
  } else if (!afterTypedByKey && !afterLegacyByKey) {
    console.log("\n🟡 Neither write happened — handler did not enter the if-not-existing block");
  }
}

// 4. Cleanup — remove the probe rows so they don't pollute production data.
await prisma.brainBusEvent.delete({ where: { id: event.id } }).catch(() => {});
await prisma.autonomousEvent.deleteMany({ where: { eventId: probeId.slice(0, 80) } }).catch(() => {});
await prisma.brainMemory.deleteMany({ where: { category: "autonomous_event", key: probeId } }).catch(() => {});
console.log("\n✅ cleanup complete");

await prisma.$disconnect();
