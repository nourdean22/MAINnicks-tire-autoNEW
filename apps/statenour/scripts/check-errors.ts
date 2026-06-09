import { prisma } from "../lib/prisma";

async function main() {
  const errors = await prisma.auditEvent.findMany({
    where: { eventType: "ai_error" },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  for (const err of errors) {
    console.log(`\n======================================================`);
    console.log(`Created At: ${err.createdAt.toISOString()}`);
    console.log(`Actor/Domain: ${err.actor}`);
    console.log(`Detail: ${err.detail}`);
    console.log(`Payload:`, JSON.stringify(err.payload, null, 2));
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
