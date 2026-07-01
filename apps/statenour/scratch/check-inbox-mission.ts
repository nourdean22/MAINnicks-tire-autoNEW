import { prisma } from "../lib/prisma";

async function main() {
  const missions = await prisma.mission.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true },
  });
  console.log("All Active Missions:", JSON.stringify(missions, null, 2));
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
