// Deep-check · why /tasks looks empty even though DB has 145 active rows
const { prisma: p } = await import("../lib/prisma.ts");

const now = new Date();
const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const startOf7d = new Date(startOfToday.getTime() - 6 * 86400000);

console.log("=== STATUS GROUP (ALL · including deleted) ===");
const groupAll = await p.task.groupBy({ by: ["status"], _count: true });
for (const r of groupAll) console.log(`  ${r.status}: ${r._count}`);

console.log("\n=== STATUS GROUP (active only · deletedAt null) ===");
const groupActive = await p.task.groupBy({
  by: ["status"],
  _count: true,
  where: { deletedAt: null },
});
for (const r of groupActive) console.log(`  ${r.status}: ${r._count}`);

console.log("\n=== UPDATED TODAY ===");
const updatedToday = await p.task.findMany({
  where: { updatedAt: { gte: startOfToday } },
  orderBy: { updatedAt: "desc" },
  select: { id: true, title: true, status: true, deletedAt: true, updatedAt: true, lastTouchedAt: true, completedAt: true },
});
console.log(`Found ${updatedToday.length} tasks updated since midnight today:`);
for (const t of updatedToday) {
  console.log(`  ${t.updatedAt.toISOString().slice(0, 19)} [${t.status}${t.deletedAt ? "·SOFT" : ""}] ${t.title.slice(0, 55)}`);
}

console.log("\n=== DONE TODAY ===");
const doneToday = await p.task.count({
  where: { status: "DONE", completedAt: { gte: startOfToday }, deletedAt: null },
});
console.log("Tasks completed today (completedAt >= midnight):", doneToday);

console.log("\n=== READY STATUS · ARE THERE ANY ===");
const readyAll = await p.task.count({ where: { status: "READY" } });
const readyActive = await p.task.count({ where: { status: "READY", deletedAt: null } });
console.log(`READY total: ${readyAll}, active (no soft-delete): ${readyActive}`);

console.log("\n=== TYPICAL /TASKS NOW VIEW QUERY ===");
// /tasks NOW view filters: status IN [READY, DOING] AND deletedAt null
// (matches /api/tasks?status=READY,DOING per loop-stream conventions)
const nowView = await p.task.findMany({
  where: { status: { in: ["READY", "DOING"] }, deletedAt: null },
  select: { id: true, title: true, status: true, autoPriority: true, lastTouchedAt: true },
  orderBy: { autoPriority: "desc" },
  take: 10,
});
console.log(`NOW view returns ${nowView.length} tasks (READY+DOING active):`);
for (const t of nowView) {
  console.log(`  [${t.status} pri=${t.autoPriority}] ${t.title.slice(0, 55)}`);
}

console.log("\n=== INBOX SAMPLE ===");
const inbox = await p.task.findMany({
  where: { status: "INBOX", deletedAt: null },
  select: { id: true, title: true, autoPriority: true, lastTouchedAt: true },
  orderBy: { lastTouchedAt: "desc" },
  take: 14,
});
console.log(`INBOX has ${inbox.length} active tasks:`);
for (const t of inbox) {
  console.log(`  [pri=${t.autoPriority}] ${t.title.slice(0, 55)}`);
}

console.log("\n=== COMPLETED LAST 7d ===");
const recentCompletes = await p.task.findMany({
  where: { status: "DONE", completedAt: { gte: startOf7d }, deletedAt: null },
  orderBy: { completedAt: "desc" },
  take: 20,
  select: { id: true, title: true, completedAt: true, loopKind: true, streakCount: true },
});
console.log(`Found ${recentCompletes.length} tasks completed in last 7 days:`);
const byDay = {};
for (const t of recentCompletes) {
  const day = t.completedAt?.toISOString().slice(0, 10) ?? "?";
  byDay[day] = (byDay[day] ?? 0) + 1;
}
console.log("By day:", byDay);

console.log("\n=== AUTO-PRIORITIZER CRON · STATUS ===");
try {
  const apRows = await p.brainMemory.findMany({
    where: { category: { contains: "priority" }, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { key: true, content: true, updatedAt: true },
  });
  console.log(`Found ${apRows.length} priority-related brain memories`);
  for (const r of apRows) {
    console.log(`  ${r.updatedAt.toISOString().slice(0, 19)} ${r.key}: ${r.content.slice(0, 60)}`);
  }
} catch (err) {
  console.log("BrainMemory query failed:", err.message);
}

await p.$disconnect();
console.log("\n=== DONE ===");
