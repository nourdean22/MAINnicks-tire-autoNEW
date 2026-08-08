// One-shot read-only investigation · v10.0.529.98 · operator-authorized
// Run with: node scripts/investigate-task-wipe.mjs
// Author: Wave 42 follow-up

// Re-use the project's prisma singleton (Neon adapter + slow-query
// tracker). Direct `new PrismaClient()` would fail under Prisma 6.
const { prisma: p } = await import("../lib/prisma.js").catch(async () => {
  // ts module · use tsx loader from project root
  const { register } = await import("tsx/esm/api");
  register();
  return import("../lib/prisma.ts");
});

const today = new Date();
const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

console.log("=== TASK STATE ===");
const total = await p.task.count();
const byStatus = await p.task.groupBy({ by: ["status"], _count: true, where: { deletedAt: null } });
const softDeleted = await p.task.count({ where: { deletedAt: { not: null } } });
const softDeletedToday = await p.task.count({
  where: { deletedAt: { gte: startOfToday } },
});
const softDeletedYesterday = await p.task.count({
  where: { deletedAt: { gte: startOfYesterday, lt: startOfToday } },
});

console.log("Total rows (incl deleted):", total);
console.log("Active by status:");
for (const row of byStatus) console.log(`  ${row.status}: ${row._count}`);
console.log("Soft-deleted total:", softDeleted);
console.log("Soft-deleted TODAY:", softDeletedToday);
console.log("Soft-deleted YESTERDAY:", softDeletedYesterday);

console.log("\n=== MOST RECENTLY TOUCHED 15 TASKS (any state) ===");
const recent = await p.task.findMany({
  orderBy: { lastTouchedAt: "desc" },
  take: 15,
  select: {
    id: true,
    title: true,
    status: true,
    deletedAt: true,
    lastTouchedAt: true,
    updatedAt: true,
  },
});
for (const t of recent) {
  const tag = t.deletedAt ? `SOFT@${t.deletedAt.toISOString().slice(0, 19)}` : t.status;
  console.log(`  [${tag}] ${t.title.slice(0, 55)} (last touched ${t.lastTouchedAt?.toISOString().slice(0, 19) ?? "n/a"})`);
}

console.log("\n=== AUDIT EVENTS · TODAY · TASK ACTIONS ===");
try {
  const events = await p.auditEvent.findMany({
    where: {
      createdAt: { gte: startOfYesterday },
      OR: [
        { eventType: { contains: "task", mode: "insensitive" } },
        { detail: { contains: "task", mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, createdAt: true, actor: true, eventType: true, detail: true },
  });
  console.log(`Found ${events.length} task-related audit events since yesterday:`);
  for (const e of events) {
    console.log(`  ${e.createdAt.toISOString().slice(0, 19)} [${e.actor}] ${e.eventType} :: ${(e.detail ?? "").slice(0, 80)}`);
  }
} catch (err) {
  console.log("AuditEvent query failed:", err.message);
}

console.log("\n=== TASK EVENTS · TODAY ===");
try {
  const taskEvents = await p.taskEvent.findMany({
    where: { createdAt: { gte: startOfYesterday } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, createdAt: true, kind: true, taskId: true, source: true, payload: true },
  });
  console.log(`Found ${taskEvents.length} TaskEvent rows since yesterday:`);
  const byKind = {};
  for (const e of taskEvents) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  console.log("By kind:", byKind);
  console.log("Latest 20:");
  for (const e of taskEvents.slice(0, 20)) {
    const payloadStr = e.payload ? JSON.stringify(e.payload).slice(0, 80) : "";
    console.log(`  ${e.createdAt.toISOString().slice(0, 19)} [${e.kind}] task=${e.taskId.slice(0, 12)} src=${e.source ?? "?"} ${payloadStr}`);
  }
} catch (err) {
  console.log("TaskEvent query failed:", err.message);
}

console.log("\n=== CRON JOB RUNS · TODAY ===");
try {
  const cronRuns = await p.cronJobRun.findMany({
    where: { startedAt: { gte: startOfYesterday } },
    orderBy: { startedAt: "desc" },
    take: 30,
    select: { jobName: true, startedAt: true, status: true, durationMs: true, error: true },
  });
  console.log(`Found ${cronRuns.length} cron runs since yesterday:`);
  for (const r of cronRuns) {
    console.log(`  ${r.startedAt.toISOString().slice(0, 19)} [${r.status}] ${r.jobName} (${r.durationMs ?? "?"}ms)${r.error ? " ERR:" + r.error.slice(0, 60) : ""}`);
  }
} catch (err) {
  console.log("CronJobRun query failed (model may not exist):", err.message);
}

await p.$disconnect();
console.log("\n=== DONE ===");
