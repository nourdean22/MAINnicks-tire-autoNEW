/**
 * Forensic — trace autonomous.fired events through the brain-bus to
 * find where typed dual-writes are dropping.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
const since = new Date(Date.now() - 24 * 3600_000);

const events = await prisma.brainBusEvent.findMany({
  where: { topic: "autonomous.fired", createdAt: { gte: since } },
  orderBy: { createdAt: "desc" },
  take: 5,
  select: { id: true, status: true, createdAt: true, processedAt: true, attempts: true, lastError: true, dedupeKey: true },
});
console.log("autonomous.fired events in last 24h:", events.length);
for (const e of events) console.log(JSON.stringify(e, null, 2));

const totalBus = await prisma.brainBusEvent.count({ where: { topic: "autonomous.fired", createdAt: { gte: since } } });
const handledBus = await prisma.brainBusEvent.count({ where: { topic: "autonomous.fired", createdAt: { gte: since }, processedAt: { not: null } } });
const legacyBM = await prisma.brainMemory.count({ where: { category: "autonomous_event", deletedAt: null, createdAt: { gte: since } } });
const typedAE = await prisma.autonomousEvent.count({ where: { firedAt: { gte: since } } });
console.log(`\nbus_total=${totalBus}  bus_handled=${handledBus}  brainMemory=${legacyBM}  autonomousEvent=${typedAE}`);

// Check the same for tool.verb_ratio — that one is NOT bus-mediated.
// It writes directly in lib/services/chat/persist-assistant-turn.ts.
const legacyVR = await prisma.brainMemory.count({ where: { category: "telemetry_tool_verb", deletedAt: null, createdAt: { gte: since } } });
const typedVR = await prisma.toolVerbRatio.count({ where: { createdAt: { gte: since } } });
console.log(`\ntelemetry_tool_verb · brainMemory=${legacyVR}  toolVerbRatio=${typedVR}`);

await prisma.$disconnect();
