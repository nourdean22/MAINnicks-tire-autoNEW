import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/system/health-report
 *
 * Re-runnable system audit — the JSON form of scripts/system-audit.ts.
 * Calls back into the same tables the audit pulls from and returns a
 * compact health snapshot the UI can render as a dashboard.
 *
 * Session-required (specific error messages + stack traces stay inside
 * ErrorLog; this endpoint reports counts + top patterns only).
 *
 * Query ?range=24h|7d|30d (default 7d)
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. Page consumer
 * reads `raw.data` from the envelope · pre-migration the route
 * returned `{data:{...}}` which left the page reading `data.data`
 * to get the report. Now the handler returns the inner data
 * unwrapped and apiHandler envelopes once · result is identical
 * (envelope.data === report).
 */

// May 02 · Next 16 prerender fix · CI was failing because Next tried
// to prerender this auth-gated route at build time, throwing
// "Authentication unavailable" from requireSession. force-dynamic
// skips static analysis for this handler.
export const dynamic = "force-dynamic";

function parseRange(range: string | null): { ms: number; label: string } {
  switch (range) {
    case "24h":
      return { ms: 24 * 60 * 60 * 1000, label: "24h" };
    case "30d":
      return { ms: 30 * 24 * 60 * 60 * 1000, label: "30d" };
    default:
      return { ms: 7 * 24 * 60 * 60 * 1000, label: "7d" };
  }
}

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const { ms, label } = parseRange(url.searchParams.get("range"));
    const since = new Date(Date.now() - ms);
    // v10.0.222 · prior-window baseline · same shape, same length, but
    // shifted back one window (e.g. 7d → days 7-14 ago). The UI uses
    // these to drive TrendCounter deltas without a second round-trip.
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
      // OpenLoop retired Apr 18 — inbox-Task is the unified home now.
      prisma.task.count({ where: { status: "INBOX" } }),
      prisma.driftAlert.count({ where: { acknowledged: false } }),
    ]);

    // ── Brain signal freshness ──
    // Apr 19 · DailyScore retired. Replaced the score-freshness tile
    // with identity-snapshot refresh freshness so this row tracks the
    // brain-learning crons (which are the new source of self-model
    // recency).
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

    // ── Law feedback loop (Apr 17 wiring) ──
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
      // v10.0.275 · two new tiles · lens-firing + voice-calls. Both
      // are derived from SystemMetric / VAPI-API in their dedicated
      // endpoints; here we just compute the headline numbers so the
      // /system/health surface has the full picture in one fetch.
      lens: await (async () => {
        try {
          const sinceLens = new Date(Date.now() - ms);
          const rows = await prisma.systemMetric.findMany({
            where: { metric: "ai.lens_fired", createdAt: { gte: sinceLens } },
            select: { value: true, tags: true },
          });
          const totalFires = rows.length;
          let fallbacks = 0;
          const frameworkCounts = new Map<string, number>();
          for (const r of rows) {
            const tags = r.tags as Record<string, unknown> | null;
            const fw = (typeof tags?.framework === "string" ? tags.framework : "(unknown)");
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
              totalFires > 0
                ? Number(((fallbacks / totalFires) * 100).toFixed(1))
                : 0,
            top,
          };
        } catch {
          return { totalFires: 0, fallbackRate: 0, top: [] };
        }
      })(),
      voice: await (async () => {
        try {
          const apiKey = process.env.VAPI_API_KEY?.trim();
          if (!apiKey) return null;
          const sinceVoice = new Date(Date.now() - ms);
          const r = await fetch(
            `https://api.vapi.ai/call?limit=100&createdAtGt=${encodeURIComponent(sinceVoice.toISOString())}`,
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
      })(),
      // v10.0.222 · prior-window baselines for TrendCounter deltas.
      // Shape mirrors the top-level metrics (only the ones the UI
      // actually shows in the headline grid). Adding more later is
      // additive — UI can ignore unknown fields.
      previous: {
        cronTotal: priorCronLogs.length,
        cronFailures: priorCronFailureCount,
        errorTotal: priorErrCount,
      },
    };
  },
  { auth: "owner" },
);
