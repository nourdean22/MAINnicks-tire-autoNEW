// 2026-05-18 · Railway BuildKit snapshot was stuck on a stale
// xlcz1rbthtyc9xz5avtbuesdd ref · 8 consecutive deploys failed at
// COPY package.json step despite no real changes · forced a watched-
// file source change (this comment) to trigger fresh context upload.
import { apiHandler } from "@/lib/utils/http";
import { prisma, checkDbConnection } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
// 2026-05-17 follow-up · WAVE-200 Inngest visibility on the health
// surface. Pre-fix the operator had to open /api/inngest to see
// Inngest config state · now it's part of the single health probe.
import { isInngestFullyConfigured } from "@/src/inngest/client";
import { MEGA_JOB_COUNTS } from "@/src/inngest/jobs";
// Braintrust wrap status from Wave-200 Phase 7 follow-up · surfaces
// the actual wrap outcome (active/failed/inactive), not just env
// presence.
import { braintrustWrapStatus } from "@/lib/ai/braintrust-wrap";

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
      // 2026-05-17 follow-up · WAVE-200 substrate visibility
      inngest: {
        configured: isInngestFullyConfigured(),
        // 2026-05-18 · 8 functions: morning + evening mega-fanouts ·
        // operator-morning-brief · customer-preferences-recompute ·
        // bulk-sms-approval (template) · goal-pruner (Phase A.1) ·
        // journal-convergence-scan (Phase D) · journal-thread-dormancy (Phase D)
        functions: 8,
        megaJobs: MEGA_JOB_COUNTS,
      },
      braintrust: { status: braintrustWrapStatus() },
      agentV2: {
        enabled: (process.env.AGENT_V2 ?? "").trim().toLowerCase() === "true",
      },
    };
  });
});
