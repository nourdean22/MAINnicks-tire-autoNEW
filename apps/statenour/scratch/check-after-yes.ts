import { prisma } from "../lib/prisma";

async function main() {
  const messages = await prisma.chatMessage.findMany({
    where: {
      conversationId: "cmr0xpww2003snq01u7hbzam2",
    },
    orderBy: { createdAt: "asc" },
  });

  console.log("Messages in convo cmr0xpww2003snq01u7hbzam2:");
  console.log(JSON.stringify(messages, null, 2));
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
