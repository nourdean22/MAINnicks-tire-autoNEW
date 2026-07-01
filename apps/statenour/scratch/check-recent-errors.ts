import { prisma } from "../lib/prisma";

async function main() {
  const today = new Date("2026-06-29");
  const events = await prisma.auditEvent.findMany({
    where: {
      createdAt: {
        gte: today,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  console.log(`Found ${events.length} events for today:`);
  for (const event of events) {
    console.log(`\n======================================================`);
    console.log(`[${event.createdAt.toISOString()}] Type: ${event.eventType} | Actor: ${event.actor}`);
    console.log(`Detail: ${event.detail}`);
    if (event.payload) {
      console.log(`Payload:`, JSON.stringify(event.payload, null, 2));
    }
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
