import { prisma } from "../lib/prisma";

async function main() {
  const activeMissions = await prisma.mission.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, domain: true, status: true },
  });

  const activeGoals = await prisma.lifeGoal.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, domain: true },
  });

  const activeTasks = await prisma.task.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, loopKind: true, status: true, missionId: true, mission: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  console.log("=== ACTIVE MISSIONS ===");
  console.log(activeMissions);

  console.log("\n=== ACTIVE GOALS ===");
  console.log(activeGoals);

  console.log("\n=== ACTIVE TASKS (sample 30) ===");
  console.log(activeTasks);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
