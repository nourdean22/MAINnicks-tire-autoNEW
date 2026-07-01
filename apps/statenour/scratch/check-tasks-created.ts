import { prisma } from "../lib/prisma";

async function main() {
  const tasks = await prisma.task.findMany({
    where: {
      createdAt: {
        gte: new Date("2026-06-30T17:40:00.000Z"),
      },
    },
    select: {
      id: true,
      title: true,
      status: true,
      missionId: true,
      mission: { select: { title: true } },
      createdAt: true,
    },
  });

  console.log("Tasks created since 17:40 today:");
  console.log(JSON.stringify(tasks, null, 2));
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
