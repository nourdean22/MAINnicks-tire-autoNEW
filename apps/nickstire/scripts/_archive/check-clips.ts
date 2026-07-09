import { prisma } from "../server/db";

async function main() {
  const job = await prisma.reelJob.findUnique({
    where: { id: 30008 },
    include: { segments: { include: { clip: true } } },
  });
  console.log(JSON.stringify(job?.segments.map(s => s.clip.storageUrl), null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
