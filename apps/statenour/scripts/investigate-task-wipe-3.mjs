// Find WHEN the 117 INBOX tasks were soft-deleted
const { prisma: p } = await import("../lib/prisma.ts");

console.log("=== SOFT-DELETE TIMELINE ===");
// Group soft-deletes by day to find the mass-delete event
const allSoftDeleted = await p.task.findMany({
  where: { deletedAt: { not: null } },
  select: { id: true, title: true, status: true, deletedAt: true, createdBy: true, updatedBy: true },
  orderBy: { deletedAt: "desc" },
});

console.log(`Total soft-deleted: ${allSoftDeleted.length}`);
const byDay = {};
const byStatus = {};
const byActor = {};
for (const t of allSoftDeleted) {
  const day = t.deletedAt?.toISOString().slice(0, 10) ?? "?";
  byDay[day] = (byDay[day] ?? 0) + 1;
  byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  const actor = t.updatedBy ?? t.createdBy ?? "unknown";
  byActor[actor] = (byActor[actor] ?? 0) + 1;
}

console.log("\nSoft-deletes by day (most recent first):");
const sortedDays = Object.keys(byDay).sort().reverse();
for (const day of sortedDays.slice(0, 20)) {
  console.log(`  ${day}: ${byDay[day]} tasks`);
}

console.log("\nSoft-deletes by original status:");
for (const [s, n] of Object.entries(byStatus)) console.log(`  ${s}: ${n}`);

console.log("\nSoft-deletes by actor (updatedBy or createdBy):");
for (const [a, n] of Object.entries(byActor)) console.log(`  ${a}: ${n}`);

console.log("\n=== MASS-DELETE DAY DETAIL ===");
// Find the day with the biggest mass-delete · show 20 sample titles
const massDeleteDay = sortedDays.reduce((biggest, day) => (byDay[day] > (byDay[biggest] ?? 0) ? day : biggest), sortedDays[0]);
console.log(`Biggest day: ${massDeleteDay} (${byDay[massDeleteDay]} tasks)`);
const dayStart = new Date(massDeleteDay + "T00:00:00Z");
const dayEnd = new Date(massDeleteDay + "T23:59:59Z");
const samples = await p.task.findMany({
  where: { deletedAt: { gte: dayStart, lte: dayEnd } },
  select: { id: true, title: true, status: true, deletedAt: true, updatedBy: true },
  orderBy: { deletedAt: "asc" },
  take: 30,
});
console.log("Sample (first 30 by deletedAt):");
for (const t of samples) {
  console.log(`  ${t.deletedAt?.toISOString().slice(11, 19)} [${t.status}] by=${t.updatedBy ?? "?"} :: ${t.title.slice(0, 55)}`);
}

console.log("\n=== AUDIT EVENTS THAT DAY ===");
try {
  const auditEvents = await p.auditEvent.findMany({
    where: { createdAt: { gte: dayStart, lte: dayEnd } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, actor: true, eventType: true, detail: true },
  });
  console.log(`Found ${auditEvents.length} audit events that day:`);
  for (const e of auditEvents.slice(0, 30)) {
    console.log(`  ${e.createdAt.toISOString().slice(11, 19)} [${e.actor}] ${e.eventType} :: ${(e.detail ?? "").slice(0, 60)}`);
  }
} catch (err) {
  console.log("AuditEvent query failed:", err.message);
}

await p.$disconnect();
console.log("\n=== DONE ===");
