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
    // 2026-05-18 PM · Phase D radar visibility added (4 extra cheap counts)
    const [
      db,
      alertCount,
      taskCounts,
      commitmentCount,
      deviceCounts,
      threadCounts,
      candidateCount,
      suggestionCount,
    ] = await Promise.all([
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
      // Phase D radar telemetry · 2026-05-18 PM follow-up · groupBy
      // on status surfaces active + dormant + archived counts in
      // one round-trip.
      prisma.journalThread.groupBy({
        by: ["status"],
        where: { deletedAt: null },
        _count: { id: true },
      }).catch((): never[] => []),
      // Pending convergence candidates (cron-detected, awaiting
      // operator naming). High count = operator hasn't visited
      // /journal in a while.
      prisma.brainMemory.count({
        where: {
          category: "journal_convergence_candidate",
          deletedAt: null,
        },
      }).catch(() => 0),
      // Pending auto-join suggestions (0.65-0.80 sim band). High
      // count = lots of borderline matches waiting for triage.
      prisma.brainMemory.count({
        where: {
          category: "journal_thread_suggestion",
          deletedAt: null,
        },
      }).catch(() => 0),
    ]);

    // Morning brief readiness · 2026-05-18 PM follow-up · used by the
    // homescreen narrator to lead with 'brief ready' when present.
    // Cheap probe · the brief row is indexed by composite (category, key).
    const today = new Date().toISOString().slice(0, 10);
    const briefRow = await prisma.brainMemory
      .findUnique({
        where: { category_key: { category: "morning_brief", key: today } },
        select: { updatedAt: true },
      })
      .catch(() => null);
    const morningBrief = {
      ready: briefRow != null,
      date: today,
      composedAt: briefRow?.updatedAt?.toISOString() ?? null,
    };

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

    // Phase D radar rollup · same shape as devices/tasks groupBy.
    const radar = {
      threads: { active: 0, dormant: 0, archived: 0, total: 0 },
      pendingCandidates: candidateCount,
      pendingSuggestions: suggestionCount,
    };
    for (const g of threadCounts) {
      const count = g._count.id;
      radar.threads.total += count;
      if (g.status === "active") radar.threads.active = count;
      else if (g.status === "dormant") radar.threads.dormant = count;
      else if (g.status === "archived") radar.threads.archived = count;
    }

    return {
      status: db.connected ? "healthy" : "degraded",
      db: { connected: db.connected, latency_ms: db.latency_ms },
      tasks,
      alerts: { unresolved: alertCount },
      commitments: { active: commitmentCount },
      devices,
      radar,
      morningBrief,
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
