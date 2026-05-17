import { prisma } from "../lib/prisma";
(async () => {
  const rows = await prisma.commitment.findMany({
    where: { status: { in: ["active", "in_progress"] } },
    select: { id: true, description: true, status: true, createdAt: true, updatedAt: true, deadline: true, dateMade: true, toWhom: true, domain: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const now = Date.now();
  for (const r of rows) {
    const ageD = Math.floor((now - new Date(r.createdAt).getTime()) / 86400000);
    const updD = Math.floor((now - new Date(r.updatedAt).getTime()) / 86400000);
    console.log(`[${ageD}d old, upd ${updD}d · ${r.toWhom ?? "?"} · ${r.domain ?? "?"}] ${r.description.slice(0,100)}`);
  }
  console.log("total active:", rows.length);
  await prisma.$disconnect();
})();
