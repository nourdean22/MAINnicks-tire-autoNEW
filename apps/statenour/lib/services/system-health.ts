/**
 * lib/services/system-health.ts · Phase S.2 (2026-05-18 PM)
 *
 * Single-source-of-truth health report builder. Extracted from
 * `app/api/system/health-report/route.ts` so the REST handler AND the
 * new tRPC procedure (`trpc.system.healthReport`) both call the same
 * function · drift between the two consumers is structurally
 * impossible.
 *
 * Returns the typed HealthReport snapshot the /system/health page
 * renders. Range = 24h | 7d | 30d. All inputs validated by the caller.
 */

import { prisma } from "@/lib/prisma";

export type HealthRange = "24h" | "7d" | "30d";

export interface HealthReport {
  range: HealthRange;
  generatedAt: string;
  cron: {
    totalLogs: number;
    failureCount: number;
    jobs: Array<{
      jobName: string;
      success: number;
      failed: number;
      avgMs: number;
      healthy: boolean;
    }>;
  };
  errors: {
    total: number;
    topPatterns: Array<{ msg: string; count: number }>;
  };
  backlog: {
    activeCaptures: number;
    activeCommitments: number;
    inboxTasks: number;
    unackedDriftAlerts: number;
  };
  freshness: {
    lastBrainDumpHoursAgo: number | null;
    lastReflectionHoursAgo: number | null;
    lastCaptureHoursAgo: number | null;
    lastIdentityRefreshHoursAgo: number | null;
    lastSkillExtractionHoursAgo: number | null;
  };
  lawFeedback: {
    situationLogsWithLawId: number;
    triggerContextLogs: number;
  };
  vectorIndex: Array<{ sourceType: string; count: number }>;
  lens: {
    totalFires: number;
    fallbackRate: number;
    top: Array<{ framework: string; count: number }>;
  };
  voice: {
    totalCalls: number;
    avgDurationSec: number;
    totalCostUsd: number;
  } | null;
  previous: {
    cronTotal: number;
    cronFailures: number;
    errorTotal: number;
  };
}

function parseRange(range: HealthRange): { ms: number; label: HealthRange } {
  switch (range) {
    case "24h":
      return { ms: 24 * 60 * 60 * 1000, label: "24h" };
    case "30d":
      return { ms: 30 * 24 * 60 * 60 * 1000, label: "30d" };
    default:
      return { ms: 7 * 24 * 60 * 60 * 1000, label: "7d" };
  }
}

export async function buildHealthReport(args: { range: HealthRange }): Promise<HealthReport> {
  const { ms, label } = parseRange(args.range);
  const since = new Date(Date.now() - ms);
  // v10.0.222 · prior-window baseline · same shape, shifted back one
  // window (e.g. 7d → days 7-14 ago). UI uses for TrendCounter deltas.
  const priorSince = new Date(Date.now() - 2 * ms);
  const priorEnd = since;

  // ── Cron health ──
  const cronLogs = await prisma.cronJobLog.findMany({
    where: { createdAt: { gte: since } },
    select: { jobName: true, status: true, duration: true, createdAt: true },
  });
  const priorCronLogs = await prisma.cronJobLog.findMany({
    where: { createdAt: { gte: priorSince, lt: priorEnd } },
    select: { status: true },
  });
  const priorCronFailureCount = priorCronLogs.filter((l) => l.status !== "success").length;

  const cronByJob = new Map<string, { success: number; failed: number; totalMs: number }>();
  for (const l of cronLogs) {
    const e = cronByJob.get(l.jobName) ?? { success: 0, failed: 0, totalMs: 0 };
    if (l.status === "success") e.success++;
    else e.failed++;
    e.totalMs += l.duration ?? 0;
    cronByJob.set(l.jobName, e);
  }
  const cronSummary = [...cronByJob.entries()].map(([jobName, s]) => ({
    jobName,
    success: s.success,
    failed: s.failed,
    avgMs: Math.round(s.totalMs / Math.max(s.success + s.failed, 1)),
    healthy: s.failed === 0,
  }));

  // ── Error patterns ──
  const errCount = await prisma.errorLog.count({ where: { createdAt: { gte: since } } });
  const priorErrCount = await prisma.errorLog.count({
    where: { createdAt: { gte: priorSince, lt: priorEnd } },
  });
  const topErrors = await prisma.errorLog.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { message: true },
  });
  const errByMsg = new Map<string, number>();
  for (const e of topErrors) {
    const key = e.message.slice(0, 80);
    errByMsg.set(key, (errByMsg.get(key) ?? 0) + 1);
  }
  const topErrorPatterns = [...errByMsg.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([msg, count]) => ({ msg, count }));

  // ── Backlog pressure ──
  const [activeCap, pendingCommit, inboxTasks, unackDrift] = await Promise.all([
    prisma.captureInboxItem.count({ where: { status: "active" } }),
    prisma.commitment.count({ where: { status: { in: ["active", "in_progress"] } } }),
    prisma.task.count({ where: { status: "INBOX" } }),
    prisma.driftAlert.count({ where: { acknowledged: false } }),
  ]);

  // ── Brain signal freshness ──
  const [lastBrainDump, lastReflection, lastCapture, lastIdentityRefresh, lastSkillExtract] = await Promise.all([
    prisma.brainDump.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.reflection.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.captureInboxItem.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.brainMemory.findUnique({
      where: { category_key: { category: "identity_snapshot", key: "current" } },
      select: { updatedAt: true },
    }).catch(() => null),
    prisma.cronJobLog.findFirst({
      where: { jobName: "extract-skills", status: "success" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }).catch(() => null),
  ]);

  // ── Law feedback loop ──
  const [lawLogs, triggerLogs] = await Promise.all([
    prisma.situationLog.count({ where: { lawId: { not: null }, createdAt: { gte: since } } }),
    prisma.situationLog.count({
      where: { context: { startsWith: "trigger:" }, createdAt: { gte: since } },
    }),
  ]);

  // ── Vector coverage ──
  const vectorCoverage = await prisma.vectorEmbedding.groupBy({
    by: ["sourceType"],
    _count: { _all: true },
  });

  const now = Date.now();
  const agoH = (d: Date | null | undefined) =>
    d ? Math.round((now - d.getTime()) / (60 * 60 * 1000)) : null;

  // ── Lens summary ──
  const lens = await (async () => {
    try {
      const rows = await prisma.systemMetric.findMany({
        where: { metric: "ai.lens_fired", createdAt: { gte: since } },
        select: { value: true, tags: true },
      });
      const totalFires = rows.length;
      let fallbacks = 0;
      const frameworkCounts = new Map<string, number>();
      for (const r of rows) {
        const tags = r.tags as Record<string, unknown> | null;
        const fw = typeof tags?.framework === "string" ? tags.framework : "(unknown)";
        if (fw === "(fallback)") fallbacks += 1;
        frameworkCounts.set(fw, (frameworkCounts.get(fw) ?? 0) + 1);
      }
      const top = Array.from(frameworkCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([framework, count]) => ({ framework, count }));
      return {
        totalFires,
        fallbackRate:
          totalFires > 0 ? Number(((fallbacks / totalFires) * 100).toFixed(1)) : 0,
        top,
      };
    } catch {
      return { totalFires: 0, fallbackRate: 0, top: [] };
    }
  })();

  // ── VAPI voice summary (optional · null if VAPI_API_KEY unset) ──
  const voice = await (async () => {
    try {
      const apiKey = process.env.VAPI_API_KEY?.trim();
      if (!apiKey) return null;
      const r = await fetch(
        `https://api.vapi.ai/call?limit=100&createdAtGt=${encodeURIComponent(since.toISOString())}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          cache: "no-store",
          signal: AbortSignal.timeout(4_000),
        },
      );
      if (!r.ok) return null;
      const calls = (await r.json()) as Array<{
        startedAt?: string;
        endedAt?: string;
        endedReason?: string | null;
        costBreakdown?: { total?: number };
        cost?: number;
      }>;
      let durationSum = 0;
      let durationCount = 0;
      let costSum = 0;
      for (const c of calls) {
        if (c.startedAt && c.endedAt) {
          const d = new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime();
          if (d > 0) {
            durationSum += d;
            durationCount += 1;
          }
        }
        const cost = c.costBreakdown?.total ?? c.cost ?? 0;
        if (typeof cost === "number") costSum += cost;
      }
      return {
        totalCalls: calls.length,
        avgDurationSec:
          durationCount > 0 ? Math.round(durationSum / durationCount / 1000) : 0,
        totalCostUsd: Number(costSum.toFixed(2)),
      };
    } catch {
      return null;
    }
  })();

  return {
    range: label,
    generatedAt: new Date().toISOString(),
    cron: {
      totalLogs: cronLogs.length,
      jobs: cronSummary,
      failureCount: cronSummary.reduce((s, j) => s + j.failed, 0),
    },
    errors: {
      total: errCount,
      topPatterns: topErrorPatterns,
    },
    backlog: {
      activeCaptures: activeCap,
      activeCommitments: pendingCommit,
      inboxTasks,
      unackedDriftAlerts: unackDrift,
    },
    freshness: {
      lastBrainDumpHoursAgo: agoH(lastBrainDump?.createdAt),
      lastReflectionHoursAgo: agoH(lastReflection?.createdAt),
      lastCaptureHoursAgo: agoH(lastCapture?.createdAt),
      lastIdentityRefreshHoursAgo: agoH(lastIdentityRefresh?.updatedAt),
      lastSkillExtractionHoursAgo: agoH(lastSkillExtract?.createdAt),
    },
    lawFeedback: {
      situationLogsWithLawId: lawLogs,
      triggerContextLogs: triggerLogs,
    },
    vectorIndex: vectorCoverage.map((v) => ({
      sourceType: v.sourceType,
      count: v._count._all,
    })),
    lens,
    voice,
    previous: {
      cronTotal: priorCronLogs.length,
      cronFailures: priorCronFailureCount,
      errorTotal: priorErrCount,
    },
  };
}
