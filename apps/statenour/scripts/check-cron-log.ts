import { prisma } from "../lib/prisma";
(async () => {
  const rows = await prisma.cronJobLog.findMany({
    where: { jobName: "consolidate" },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { jobName: true, createdAt: true, status: true, error: true, duration: true },
  });
  for (const r of rows) {
    console.log(`\n=== ${r.createdAt.toISOString()} · ${r.jobName} · ${r.status} · ${r.duration}ms ===`);
    console.log(r.error ?? "(no error)");
  }
  await prisma.$disconnect();
})();
