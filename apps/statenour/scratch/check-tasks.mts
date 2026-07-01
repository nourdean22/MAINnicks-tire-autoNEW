import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const recent = await prisma.task.findMany({
  where: { deletedAt: null },
  orderBy: { createdAt: "desc" },
  take: 10,
  select: { id: true, title: true, status: true, missionId: true, createdAt: true },
});

console.log("=== 10 MOST RECENT TASKS ===");
for (const r of recent) {
  console.log(`[${r.status}] ${r.title.slice(0, 50)} | mission:${r.missionId ?? "null"} | ${r.createdAt.toISOString().slice(0, 19)}`);
}

const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
const fresh = recent.filter(r => r.createdAt > cutoff);
console.log(`\n=== TASKS IN LAST 24H: ${fresh.length} ===`);
for (const r of fresh) {
  console.log(`  [${r.status}] ${r.title.slice(0, 60)} | mission:${r.missionId ?? "null"}`);
}

await prisma.$disconnect();
