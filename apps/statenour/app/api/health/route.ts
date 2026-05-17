import { apiHandler } from "@/lib/utils/http";
import { prisma, checkDbConnection } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";

// v10.0.514 · 30s outer cache. The 2026-05-12 slow-paths Lighthouse
// addendum showed this route at 5.5s on the homepage with 5 parallel
// Prisma calls including 3 groupBy operations. Health endpoints
// should be sub-100ms · the slow latency was cold-connection +
// groupBy cost compounding. 30s TTL is acceptable for a health
// surface (task/commitment counts don't move that fast) and brings
// warm-cache hits sub-50ms.
export const GET = apiHandler(async () => {
  return cached("health_v1", 30, async () => {
    // Apr 17 sweep: DailyScore, MorningBrief, OpenLoop models retired. The
    // health endpoint now reflects the live Task/Commitment/Drift surface.
    const [db, alertCount, taskCounts, commitmentCount, deviceCounts] =
      await Promise.all([
        checkDbConnection(),
        prisma.driftAlert.count({ where: { resolved: false } }),
        prisma.task.groupBy({ by: ["status"], _count: { id: true } }),
        prisma.commitment.count({
          where: { status: { in: ["active", "in_progress"] } },
        }),
        prisma.smartDevice.groupBy({
          by: ["status"],
          _count: { id: true },
        }),
      ]);

    const tasks = { inbox: 0, ready: 0, doing: 0, done: 0, total: 0 };
    for (const g of taskCounts) {
      const count = g._count.id;
      tasks.total += count;
      const key = g.status.toLowerCase() as keyof typeof tasks;
      if (key in tasks) tasks[key] = count;
    }

    const devices = { online: 0, offline: 0, total: 0 };
    for (const g of deviceCounts) {
      const count = g._count.id;
      devices.total += count;
      if (g.status === "ONLINE") devices.online = count;
      else devices.offline += count;
    }

    return {
      status: db.connected ? "healthy" : "degraded",
      db: { connected: db.connected, latency_ms: db.latency_ms },
      tasks,
      alerts: { unresolved: alertCount },
      commitments: { active: commitmentCount },
      devices,
    };
  });
});
