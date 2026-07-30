/**
 * lib/services/system-pulse.ts · hooks-lib REST→tRPC slice (2026-05-22)
 *
 * The FloatingHome orb-badge pulse rollup · extracted verbatim from the
 * GET /api/system/pulse route handler so the legacy REST endpoint AND
 * the new `system.pulse` tRPC procedure both call this single function
 * · drift between the two consumers is structurally impossible.
 *
 * The route's 30s module-level cache moves in here (one cache shared
 * across both transports). Every Neon query is wrapped in `safeQuery`
 * so a compute-quota exhaustion degrades the orb to 0/null instead of
 * 500-ing every page that mounts it. The return shape is the explicit
 * flat `SystemPulseView` — every field a scalar, every Date already an
 * ISO string — so no Prisma row / Json column reaches the AppRouter
 * (the TS2589 firewall · trivially satisfied here, no rows are
 * returned, only counts).
 */

import { prisma } from "@/lib/prisma";
import { safeQuery, isQuotaExhausted } from "@/lib/db/safe-prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/** Flat, explicit pulse shape · the /api/system/pulse payload. */
export interface SystemPulseView {
  cronFails24h: number;
  cronFails1h: number;
  cronsDrifted: number;
  errors24h: number;
  errorsFatal24h: number;
  errorsFatal6h: number;
  aiCalls24h: number;
  aiFailures24h: number;
  aiErrorRate: number;
  aiCalls1h: number;
  aiFailures1h: number;
  aiErrorRate1h: number;
  actionsPending: number;
  actionsFailed24h: number;
  devicesOffline: number;
  devicesTotal: number;
  nickQualityAvg7d: number | null;
  nickQualityAvgPrior7d: number | null;
  nickQualityDelta: number | null;
  nickQualityDirection: "rising" | "falling" | "flat" | "unknown";
  nickQualityReplies7d: number;
  dbQuotaExhausted: boolean;
  generatedAt: string;
  window: { since24h: string; since7d: string };
  /** Present only on a cache-hit response. */
  cached?: boolean;
  cacheAgeMs?: number;
}

// 30s module-level cache · the pulse endpoint hits the DB at most once
// per 30s across ALL consumers (every tab + the FloatingHome orb).
let cache: { data: SystemPulseView; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

/**
 * Build the system-pulse rollup. Cached 30s. The shape is identical to
 * the legacy GET /api/system/pulse payload so the FloatingHome orb +
 * any other consumer reads the same fields.
 */
export async function buildSystemPulse(): Promise<SystemPulseView> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.data, cached: true, cacheAgeMs: Date.now() - cache.at };
  }

  const since24h = new Date(Date.now() - 24 * 3600_000);
  const since6h = new Date(Date.now() - 6 * 3600_000);
  const since1h = new Date(Date.now() - 1 * 3600_000);
  const since7d = new Date(Date.now() - 7 * 86400_000);

  // If quota is known-exhausted, skip the whole fan-out.
  if (isQuotaExhausted()) {
    return {
      cronFails24h: 0, cronFails1h: 0, cronsDrifted: 0,
      errors24h: 0, errorsFatal24h: 0, errorsFatal6h: 0,
      aiCalls24h: 0, aiFailures24h: 0, aiErrorRate: 0,
      aiCalls1h: 0, aiFailures1h: 0, aiErrorRate1h: 0,
      actionsPending: 0, actionsFailed24h: 0,
      devicesOffline: 0, devicesTotal: 0,
      nickQualityAvg7d: null, nickQualityAvgPrior7d: null,
      nickQualityReplies7d: 0, nickQualityDelta: null,
      nickQualityDirection: "unknown",
      dbQuotaExhausted: true,
      generatedAt: new Date().toISOString(),
      window: { since24h: since24h.toISOString(), since7d: since7d.toISOString() },
    };
  }

  type CronBucket = { fail_24h: bigint; fail_1h: bigint };
  type ErrorBucket = { errors_24h: bigint; fatal_24h: bigint; fatal_6h: bigint };
  type AiBucket = {
    calls_24h: bigint;
    fails_24h: bigint;
    calls_1h: bigint;
    fails_1h: bigint;
  };
  const [
    cronBucket,
    cronLast48h,
    errorBucket,
    aiBucket,
    actionsPending,
    actionsFailed24h,
    dbDevices,
  ] = await Promise.all([
    safeQuery(
      async () => {
        const rows = await prisma.$queryRaw<CronBucket[]>`
          SELECT
            COUNT(*) FILTER (WHERE "createdAt" >= ${since24h} AND status = 'failed') AS fail_24h,
            COUNT(*) FILTER (WHERE "createdAt" >= ${since1h}  AND status = 'failed') AS fail_1h
          FROM cron_job_logs
          WHERE "createdAt" >= ${since24h}
        `;
        return rows[0] ?? { fail_24h: 0n, fail_1h: 0n };
      },
      { fail_24h: 0n, fail_1h: 0n } as CronBucket,
      { label: "pulse.cronBucket" },
    ),
    safeQuery(() => prisma.cronJobLog.groupBy({
      by: ["jobName"],
      where: { createdAt: { gte: new Date(Date.now() - 48 * 3600_000) } },
      _max: { createdAt: true },
    }), [] as Array<{ jobName: string; _max: { createdAt: Date | null } }>, { label: "pulse.cronLast48h" }),
    safeQuery(
      async () => {
        // "fatal" buckets count level='error' — no writer has EVER emitted
        // level='fatal' (prod probe 2026-07-30: error=389 · warn=823 · fatal=0),
        // so the old predicate made these structurally 0 and the orb blind.
        // warn stays excluded so this remains a burst signal, not noise.
        const rows = await prisma.$queryRaw<ErrorBucket[]>`
          SELECT
            COUNT(*)                                                              AS errors_24h,
            COUNT(*) FILTER (WHERE level = 'error')                               AS fatal_24h,
            COUNT(*) FILTER (WHERE level = 'error' AND created_at >= ${since6h}) AS fatal_6h
          FROM error_logs
          WHERE created_at >= ${since24h}
        `;
        return rows[0] ?? { errors_24h: 0n, fatal_24h: 0n, fatal_6h: 0n };
      },
      { errors_24h: 0n, fatal_24h: 0n, fatal_6h: 0n } as ErrorBucket,
      { label: "pulse.errorBucket" },
    ),
    safeQuery(
      async () => {
        // Failure = anything not 'complete' — trackGeneration writes
        // status 'complete' or 'error'; 'failed' has NEVER existed (prod
        // probe 2026-07-30: complete=3294, nothing else), so the old
        // predicate kept aiFailures/aiErrorRate structurally at 0.
        // Matches the percentile query's predicate in lib/ai/track.ts.
        const rows = await prisma.$queryRaw<AiBucket[]>`
          SELECT
            COUNT(*)                                                                 AS calls_24h,
            COUNT(*) FILTER (WHERE status <> 'complete')                             AS fails_24h,
            COUNT(*) FILTER (WHERE created_at >= ${since1h})                         AS calls_1h,
            COUNT(*) FILTER (WHERE created_at >= ${since1h} AND status <> 'complete') AS fails_1h
          FROM ai_generations
          WHERE created_at >= ${since24h}
        `;
        return rows[0] ?? { calls_24h: 0n, fails_24h: 0n, calls_1h: 0n, fails_1h: 0n };
      },
      { calls_24h: 0n, fails_24h: 0n, calls_1h: 0n, fails_1h: 0n } as AiBucket,
      { label: "pulse.aiBucket" },
    ),
    safeQuery(() => prisma.autonomousAction.count({ where: { approval: "pending" } }), 0, { label: "pulse.actionsPending" }),
    safeQuery(() => prisma.autonomousAction.count({ where: { createdAt: { gte: since24h }, result: "failed" } }), 0, { label: "pulse.actionsFailed" }),
    safeQuery(
      async () => {
        const r = await prisma.smartDevice.groupBy({
          by: ["status"],
          _count: { id: true },
        });
        return r as Array<{ status: string; _count: { id: number } }>;
      },
      [] as Array<{ status: string; _count: { id: number } }>,
      { label: "pulse.devices" },
    ),
  ]);

  const cronFails24h = Number(cronBucket.fail_24h);
  const cronFails1h = Number(cronBucket.fail_1h);
  const errors24h = Number(errorBucket.errors_24h);
  const errorsFatal24h = Number(errorBucket.fatal_24h);
  const errorsFatal6h = Number(errorBucket.fatal_6h);
  const aiCalls24h = Number(aiBucket.calls_24h);
  const aiFailures24h = Number(aiBucket.fails_24h);
  const aiCalls1h = Number(aiBucket.calls_1h);
  const aiFailures1h = Number(aiBucket.fails_1h);

  // Nick-quality rollup for the orb — 7d mean + 14d-ago baseline.
  let nickQualityAvg7d: number | null = null;
  let nickQualityAvgPrior7d: number | null = null;
  let nickQualityDelta: number | null = null;
  let nickQualityDirection: "rising" | "falling" | "flat" | "unknown" = "unknown";
  let nickQualityReplies7d = 0;
  try {
    const since14d = new Date(Date.now() - 14 * 86400_000);
    const { readMetadata } = await import("@/lib/brain/memory-metadata-types");
    type QMeta = import("@/lib/brain/memory-metadata-types").NickQualityMeta;
    const scorecards = await safeQuery(
      () => prisma.brainMemory.findMany({
        where: { category: BRAIN_CATEGORIES.NICK_QUALITY, createdAt: { gte: since14d } },
        select: { metadata: true, createdAt: true },
        take: 1000,
      }),
      [] as Array<{ metadata: unknown; createdAt: Date }>,
      { label: "pulse.nickQuality" },
    );
    const scores7d: number[] = [];
    const scoresPrior7d: number[] = [];
    const since7dMs = since7d.getTime();
    for (const s of scorecards) {
      const m = readMetadata<QMeta>(s.metadata);
      if (typeof m.overall !== "number") continue;
      if (s.createdAt.getTime() >= since7dMs) {
        scores7d.push(m.overall);
      } else {
        scoresPrior7d.push(m.overall);
      }
    }
    nickQualityReplies7d = scores7d.length;
    if (scores7d.length > 0) {
      nickQualityAvg7d = Math.round(scores7d.reduce((a, b) => a + b, 0) / scores7d.length);
    }
    if (scoresPrior7d.length > 0) {
      nickQualityAvgPrior7d = Math.round(
        scoresPrior7d.reduce((a, b) => a + b, 0) / scoresPrior7d.length
      );
    }
    if (nickQualityAvg7d !== null && nickQualityAvgPrior7d !== null) {
      nickQualityDelta = nickQualityAvg7d - nickQualityAvgPrior7d;
      nickQualityDirection =
        nickQualityDelta >= 3 ? "rising" : nickQualityDelta <= -3 ? "falling" : "flat";
    }
  } catch {
    // non-fatal
  }

  // cronsDrifted = jobs whose last run is OVERDUE based on schedule.
  const now = Date.now();
  const { CRONS } = await import("@/config/crons");
  const intervalMs = (schedule: string | null | undefined): number => {
    if (!schedule) return 6 * 3600_000;
    if (/^\*\/(\d+) \* \* \* \*$/.test(schedule)) {
      const m = schedule.match(/^\*\/(\d+)/);
      return Math.max(60_000, parseInt(m![1], 10) * 60_000);
    }
    if (/^\d+ \*\/(\d+) \* \* \*$/.test(schedule)) {
      const m = schedule.match(/\*\/(\d+)/);
      return parseInt(m![1], 10) * 3600_000;
    }
    if (/^\d+ \* \* \* \*$/.test(schedule)) return 60 * 60_000;
    if (/^\d+ \d+(?:,\d+)+ \* \* \*$/.test(schedule)) {
      const hours = schedule.split(" ")[1].split(",").length;
      return Math.floor(24 / Math.max(1, hours)) * 3600_000;
    }
    if (/^\d+ \d+ \* \* \*$/.test(schedule)) return 24 * 3600_000;
    if (/^\d+ \d+ \* \* \d/.test(schedule)) return 7 * 24 * 3600_000;
    if (/^\d+ \d+ \* \* (?:[\d,]+)$/.test(schedule)) {
      const days = schedule.split(" ")[4].split(",").length;
      return Math.max(1, Math.floor(7 / days)) * 24 * 3600_000;
    }
    return 6 * 3600_000;
  };
  const driftThresholdByName = new Map<string, number>();
  for (const c of CRONS) {
    if (c.mode === "active" && c.schedule) {
      driftThresholdByName.set(c.name, Math.max(30 * 60_000, intervalMs(c.schedule) * 2));
    }
  }
  const cronByName = new Map(CRONS.map((c) => [c.name, c]));
  for (const c of CRONS) {
    if (c.mode !== "folded") continue;
    let parent = c.foldedInto;
    let hops = 0;
    while (parent && hops < 3) {
      const t = driftThresholdByName.get(parent);
      if (t) {
        driftThresholdByName.set(c.name, t);
        break;
      }
      const next = cronByName.get(parent);
      parent = next?.foldedInto ?? undefined;
      hops++;
    }
    if (!driftThresholdByName.has(c.name)) {
      driftThresholdByName.set(c.name, 48 * 3600_000);
    }
  }
  const cronsDrifted = cronLast48h.filter((r) => {
    if (!r._max.createdAt) return false;
    const threshold = driftThresholdByName.get(r.jobName) ?? 6 * 3600_000;
    return now - new Date(r._max.createdAt).getTime() > threshold;
  }).length;

  const aiErrorRate = aiCalls24h > 0 ? Math.round((aiFailures24h / aiCalls24h) * 100) : 0;
  const aiErrorRate1h =
    aiCalls1h >= 3 ? Math.round((aiFailures1h / aiCalls1h) * 100) : 0;

  const devicesOffline = dbDevices
    .filter((d) => d.status === "OFFLINE" || d.status === "ERROR" || d.status === "UNKNOWN")
    .reduce((s: number, d) => s + d._count.id, 0);
  const devicesTotal = dbDevices.reduce((s: number, d) => s + d._count.id, 0);

  const result: SystemPulseView = {
    cronFails24h,
    cronFails1h,
    cronsDrifted,
    errors24h,
    errorsFatal24h,
    errorsFatal6h,
    aiCalls24h,
    aiFailures24h,
    aiErrorRate,
    aiCalls1h,
    aiFailures1h,
    aiErrorRate1h,
    actionsPending,
    actionsFailed24h,
    devicesOffline,
    devicesTotal,
    nickQualityAvg7d,
    nickQualityAvgPrior7d,
    nickQualityDelta,
    nickQualityDirection,
    nickQualityReplies7d,
    dbQuotaExhausted: isQuotaExhausted(),
    generatedAt: new Date().toISOString(),
    window: {
      since24h: since24h.toISOString(),
      since7d: since7d.toISOString(),
    },
  };

  cache = { data: result, at: Date.now() };
  return result;
}
