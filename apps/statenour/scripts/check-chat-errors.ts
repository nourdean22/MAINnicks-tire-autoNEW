import { prisma } from "../lib/prisma";

async function main() {
  const recentChats = await prisma.chatConversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 5,
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  for (const chat of recentChats) {
    console.log(`\n======================================================`);
    console.log(`Chat ID: ${chat.id} | Title: ${chat.title} | Created: ${chat.createdAt.toISOString()}`);
    
    for (const msg of chat.messages) {
      console.log(`\n[${msg.role}] at ${msg.createdAt.toISOString()}`);
      console.log(JSON.stringify(msg.parts, null, 2));
    }
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
