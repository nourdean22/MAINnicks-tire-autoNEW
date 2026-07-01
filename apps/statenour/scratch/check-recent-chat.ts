import { prisma } from "../lib/prisma";

async function main() {
  const messages = await prisma.chatMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  console.log(`Found ${messages.length} recent chat messages:`);
  for (const msg of messages) {
    console.log(`\n======================================================`);
    console.log(`[${msg.createdAt.toISOString()}] ID: ${msg.id} | Convo ID: ${msg.conversationId} | Role: ${msg.role}`);
    console.log(`Content: ${msg.content.slice(0, 300)}`);
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
