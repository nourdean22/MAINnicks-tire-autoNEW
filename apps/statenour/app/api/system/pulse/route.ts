import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { safeQuery, isQuotaExhausted } from "@/lib/db/safe-prisma";

/**
 * GET /api/system/pulse — the tiny rollup that powers the FloatingHome
 * nav badges + any other "is the system OK?" widget.
 *
 * Fast (single query round-trip, all counts). Cached 30s at client
 * layer, so even 100 tabs don't stampede prod.
 *
 * Returns only the numbers, not the rows — the dedicated /system/*
 * surfaces handle detail views.
 *
 * v11.0 cleanup · every query wrapped in safeQuery so Neon compute-
 * quota exhaustion degrades gracefully to 0/null instead of 500-ing
 * the orb + every page that loads with it.
 */

// Cache the aggregated result briefly — next.js default is no caching
// for route handlers. 30s cache means the pulse endpoint hits the DB
// at most once per 30s across ALL tabs. Before: 30s × N-tabs. After: 30s.
let cache: { data: Record<string, unknown>; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

export const GET = apiHandler(async () => {
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
      nickQualityAvg7d: null, nickQualityReplies7d: 0, nickQualityDelta: null,
      nickQualityDirection: "unknown" as const,
      dbQuotaExhausted: true,
      generatedAt: new Date().toISOString(),
      window: { since24h: since24h.toISOString(), since7d: since7d.toISOString() },
    };
  }

  // v11.2 · Consolidated pulse queries. Was 13 serial counts (one per
  // stat), now 6 round-trips total — one SQL per table with FILTERed
  // aggregations for every time-bucket we care about. Client polls
  // every 30s so per-query cost multiplies across open tabs. Neon
  // compute quota thanks us.
  //
  // SHAPES (postgres COUNT(*) FILTER):
  //   cron_bucket   · 24h_fail · 1h_fail
  //   error_bucket  · 24h_all · 24h_fatal · 6h_fatal
  //   ai_bucket     · 24h_all · 24h_fail · 1h_all · 1h_fail
  //
  // safeQuery wrapping preserved — any row that fails returns zeros
  // and the rest of the pulse still populates.
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
    cronLast48h,       // to compute drifted (still a groupBy)
    errorBucket,
    aiBucket,
    actionsPending,
    actionsFailed24h,
    dbDevices,
  ] = await Promise.all([
    safeQuery(
      async () => {
        // NB: cron_job_logs column is "createdAt" (camelCase) — the
        // CronJobLog model has NO @map("created_at") so Postgres sees
        // the quoted identifier. Unquoted would get lowercased to
        // `createdat` and fail with 42703.
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
        const rows = await prisma.$queryRaw<ErrorBucket[]>`
          SELECT
            COUNT(*)                                                              AS errors_24h,
            COUNT(*) FILTER (WHERE level = 'fatal')                               AS fatal_24h,
            COUNT(*) FILTER (WHERE level = 'fatal' AND created_at >= ${since6h}) AS fatal_6h
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
        const rows = await prisma.$queryRaw<AiBucket[]>`
          SELECT
            COUNT(*)                                                                 AS calls_24h,
            COUNT(*) FILTER (WHERE status = 'failed')                                AS fails_24h,
            COUNT(*) FILTER (WHERE created_at >= ${since1h})                         AS calls_1h,
            COUNT(*) FILTER (WHERE created_at >= ${since1h} AND status = 'failed')   AS fails_1h
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

  // Unpack buckets into named numbers (BigInt → number conversion is
  // safe here — counts never exceed Number.MAX_SAFE_INTEGER in practice).
  const cronFails24h = Number(cronBucket.fail_24h);
  const cronFails1h = Number(cronBucket.fail_1h);
  const errors24h = Number(errorBucket.errors_24h);
  const errorsFatal24h = Number(errorBucket.fatal_24h);
  const errorsFatal6h = Number(errorBucket.fatal_6h);
  const aiCalls24h = Number(aiBucket.calls_24h);
  const aiFailures24h = Number(aiBucket.fails_24h);
  const aiCalls1h = Number(aiBucket.calls_1h);
  const aiFailures1h = Number(aiBucket.fails_1h);

  // v11.0 · Nick-quality rollup for the orb — 7d mean + 14d-ago baseline
  // so the UI can show a ↗↘→ direction arrow. Cheap: two grouped reads
  // over ~1K rows total. Returns null when no data yet.
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
        where: { category: "nick_quality", createdAt: { gte: since14d } },
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

  // cronsDrifted = count of jobs whose last run is OVERDUE based on
  // their schedule. Apr 27 — was a flat 2h threshold which incorrectly
  // flagged daily/weekly crons as drifted between every run (a daily
  // cron "drifted" 22h after firing simply because it hadn't fired
  // again yet — that's the schedule, not drift). Now reads the
  // manifest and uses 2× the expected interval as the drift floor.
  const now = Date.now();
  const { CRONS } = await import("@/config/crons");
  // Map cron expressions → expected interval in ms. Conservative —
  // any cron schedule we can't parse defaults to 6h grace, so unknown
  // jobs aren't flagged for being slightly slow.
  const intervalMs = (schedule: string | null | undefined): number => {
    if (!schedule) return 6 * 3600_000;
    // Common patterns we recognize. Order matters — most specific first.
    if (/^\*\/(\d+) \* \* \* \*$/.test(schedule)) {
      const m = schedule.match(/^\*\/(\d+)/);
      return Math.max(60_000, parseInt(m![1], 10) * 60_000); // every N minutes
    }
    if (/^\d+ \*\/(\d+) \* \* \*$/.test(schedule)) {
      const m = schedule.match(/\*\/(\d+)/);
      return parseInt(m![1], 10) * 3600_000; // every N hours
    }
    if (/^\d+ \* \* \* \*$/.test(schedule)) return 60 * 60_000; // hourly
    if (/^\d+ \d+(?:,\d+)+ \* \* \*$/.test(schedule)) {
      // multi-hour-of-day, e.g. "0 8,20 * * *" → 12h
      const hours = schedule.split(" ")[1].split(",").length;
      return Math.floor(24 / Math.max(1, hours)) * 3600_000;
    }
    if (/^\d+ \d+ \* \* \*$/.test(schedule)) return 24 * 3600_000; // daily
    if (/^\d+ \d+ \* \* \d/.test(schedule)) return 7 * 24 * 3600_000; // weekly
    if (/^\d+ \d+ \* \* (?:[\d,]+)$/.test(schedule)) {
      // multi-day-of-week e.g. "30 2 * * 0,3" → ~3.5d
      const days = schedule.split(" ")[4].split(",").length;
      return Math.max(1, Math.floor(7 / days)) * 24 * 3600_000;
    }
    return 6 * 3600_000;
  };
  const driftThresholdByName = new Map<string, number>();
  // Pass 1 — direct active crons.
  for (const c of CRONS) {
    if (c.mode === "active" && c.schedule) {
      // 2× expected interval before we call it drifted, with a 30min
      // floor so sub-minute crons don't false-positive on a single
      // missed tick.
      driftThresholdByName.set(c.name, Math.max(30 * 60_000, intervalMs(c.schedule) * 2));
    }
  }
  // Pass 2 — folded crons inherit their parent's threshold. Walks the
  // foldedInto chain up to 3 hops in case a folded cron is itself
  // nested inside another folded cron (rare, but defensive).
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
    // Folded with no parent threshold (e.g. parent was retired)
    // gets a generous 48h fallback so it doesn't paint orb red.
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
  // Fresh-window error rate — require a minimum denominator so a single
  // fail on a cold hour doesn't read as 100%.
  const aiErrorRate1h =
    aiCalls1h >= 3 ? Math.round((aiFailures1h / aiCalls1h) * 100) : 0;

  // SmartDevice.status is UPPERCASE per the schema (ONLINE / OFFLINE /
  // ERROR / UNKNOWN). Previously checked lowercase → every device
  // counted as online regardless of reality. Fixed in W3.
  const devicesOffline = dbDevices
    .filter((d) => d.status === "OFFLINE" || d.status === "ERROR" || d.status === "UNKNOWN")
    .reduce((s: number, d) => s + d._count.id, 0);
  const devicesTotal = dbDevices.reduce((s: number, d) => s + d._count.id, 0);

  const result = {
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
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts