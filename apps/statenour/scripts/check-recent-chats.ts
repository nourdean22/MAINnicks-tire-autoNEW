import { prisma } from "@/lib/prisma";

async function main() {
  const conversations = await prisma.chatConversation.findMany({
    orderBy: { createdAt: "desc" },
    take: 4,
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  for (const conv of conversations) {
    console.log(`\n======================================================`);
    console.log(`Conversation ID: ${conv.id}`);
    
    for (const msg of conv.messages) {
      console.log(`\n[ROLE: ${msg.role}]`);
      console.log(`msg.parts:`, JSON.stringify(msg.parts, null, 2));
    }
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
