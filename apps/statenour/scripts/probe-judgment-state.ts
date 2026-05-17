// v10.0.412 · diagnostic · why does improve-agent see 0 judgments?
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { prisma } from "@/lib/prisma";

async function main() {
  const since7d = new Date(Date.now() - 7 * 86_400_000);
  const since30d = new Date(Date.now() - 30 * 86_400_000);

  const last7d = await prisma.brainMemory.count({
    where: { category: "reply_judgment", lastSeen: { gte: since7d }, deletedAt: null },
  });
  const last30d = await prisma.brainMemory.count({
    where: { category: "reply_judgment", lastSeen: { gte: since30d }, deletedAt: null },
  });
  const allTime = await prisma.brainMemory.count({
    where: { category: "reply_judgment", deletedAt: null },
  });

  const mostRecent = await prisma.brainMemory.findFirst({
    where: { category: "reply_judgment", deletedAt: null },
    orderBy: { lastSeen: "desc" },
    select: { key: true, content: true, lastSeen: true, createdAt: true },
  });

  console.log("reply_judgment counts:");
  console.log("  last 7d:", last7d);
  console.log("  last 30d:", last30d);
  console.log("  all time:", allTime);
  if (mostRecent) {
    console.log("\nMost recent:");
    console.log("  key:", mostRecent.key);
    console.log("  content:", mostRecent.content?.slice(0, 100));
    console.log("  lastSeen:", mostRecent.lastSeen);
    console.log("  createdAt:", mostRecent.createdAt);
  } else {
    console.log("\nNo reply_judgment memories ever persisted.");
  }

  const chatLast7d = await prisma.chatMessage.count({
    where: { role: "assistant", createdAt: { gte: since7d } },
  });
  console.log("\nFor reference · assistant chat messages last 7d:", chatLast7d);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
