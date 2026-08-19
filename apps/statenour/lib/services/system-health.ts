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

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export type HealthRange = "24h" | "7d" | "30d";

export interface HealthReport {
  range: HealthRange;
  generatedAt: string;
  cron: {
    totalLogs: number;
    /** HARD failures only. `partial` is counted separately — see below. */
    failureCount: number;
    /** 2026-08-19 · runs that completed with some children failing
     *  (mega fan-out heartbeats write status="partial"). Previously these
     *  were folded into `failureCount` by a bare `status !== "success"`,
     *  so a slow-but-successful child inflated the headline fail rate and
     *  a real failure was indistinguishable from fan-out timeout noise. */
    partialCount: number;
    jobs: Array<{
      jobName: string;
      success: number;
      partial: number;
      failed: number;
      avgMs: number;
      healthy: boolean;
    }>;
  };
  errors: {
    total: number;
    /** Distinct 80-char message prefixes across the WHOLE window. The
     *  tile used to render `topPatterns.length` (always ≤5) as "N
     *  patterns", which read as "there are 5 patterns" when it meant
     *  "here are the top 5". */
    distinctPatterns: number;
    byLevel: Array<{ level: string; count: number }>;
    topPatterns: Array<{ msg: string; count: number }>;
  };
  backlog: {
    activeCaptures: number;
    activeCommitments: number;
    inboxTasks: number;
    unackedDriftAlerts: number | null;
  };
  freshness: {
    lastBrainDumpHoursAgo: number | null;
    lastReflectionHoursAgo: number | null;
    lastCaptureHoursAgo: number | null;
    lastIdentityRefreshHoursAgo: number | null;
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
  } | null;
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
  /** 2026-05-29 · operational rollup · AI eval quality + nickstire bridge /
   *  data-source probe health. The "what's broken NOW" dimensions that
   *  weren't on this page when revenue=$0 / evals=0/75 / bridge=down. */
  operational: {
    eval: { passRate: number; passed: number; total: number; at: string } | null;
    dataSources: {
      total: number;
      failing: number;
      bridgeFailing: number;
      /** 2026-08-19 · probes whose newest row is older than
       *  PROBE_STALE_MS. A stale canary is not a healthy canary: if the
       *  data-source-health cron stops running, the last-written rows keep
       *  reporting `ok` forever and the banner stays green. That is the
       *  exact silent-dead-feeder failure these probes were built to catch,
       *  reproduced one level up. */
      stale: number;
      probes: ProbeView[];
    } | null;
  };
}

export interface ProbeView {
  name: string;
  kind: string;
  ok: boolean;
  stale: boolean;
  ageHours: number | null;
  reason: string | null;
}

/** Probes are written once per ET-day by /api/cron/data-source-health.
 *  Two missed days = the canary itself is down. */
const PROBE_STALE_MS = 48 * 60 * 60 * 1000;

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

  // ── Parallelized probes (v10.x perf · 2026-06-02) ──
  // Every section below reads a DISJOINT set of rows and none consumes
  // another's result — so they're independent. Previously they ran as a
  // long SERIAL `await` chain (cron → prior-cron → errors → backlog →
  // freshness → law → vectors → lens → VAPI → eval), making total
  // latency the SUM of every round-trip PLUS the ~4s VAPI HTTP probe
  // sitting inline (the /system/health first-paint froze ~30s+). Hoisting
  // each fetch into a promise and awaiting them in ONE Promise.all makes
  // latency the MAX of the slowest single probe instead of the sum.
  // Behavior is identical: same queries, same inputs, same per-section
  // try/catch fallbacks, same output shape — only the scheduling changes.

  // ── Cron health ──
  const cronLogsP = prisma.cronJobLog.findMany({
    where: { createdAt: { gte: since } },
    select: { jobName: true, status: true, duration: true, createdAt: true },
  });
  const priorCronLogsP = prisma.cronJobLog.findMany({
    where: { createdAt: { gte: priorSince, lt: priorEnd } },
    select: { status: true },
  });

  // ── Error patterns ──
  const errCountP = prisma.errorLog.count({ where: { createdAt: { gte: since } } });
  const priorErrCountP = prisma.errorLog.count({
    where: { createdAt: { gte: priorSince, lt: priorEnd } },
  });
  // 2026-08-19 · was `findMany({ take: 50 })` grouped in JS: with 1,423
  // errors in a 30d window that sampled the most recent 3.5% and reported
  // it as "the" top patterns, so one recent burst could hide a signature
  // that dominated the window. Grouping now happens in Postgres over every
  // row. Columns are snake_case here (`created_at`) — `check:raw-sql`
  // audits camelCase column refs in raw SQL, and error_logs maps
  // createdAt → created_at (cron_job_logs, confusingly, does NOT).
  // Grouping on the raw prefix is not enough: two writers embed a value
  // that changes every run INSIDE the first 80 chars, so one root cause
  // shattered into singleton "patterns".
  //   · lib/ai/reasoning/error-sanitizer.ts:87 leads with a per-error id
  //     (`err_<base36>_<rand>`), so every sanitized error was its own group.
  //   · counter-style reporters (knowledge-sync.ts:408 and ~12 siblings)
  //     lead with a changing count — "12 duplicate wisdom syncs skipped".
  // Normalizing ids and digit runs first collapses both back into the one
  // signature they actually represent.
  const NORMALIZED_MSG = Prisma.sql`
    LEFT(
      regexp_replace(
        regexp_replace(message, 'err_[a-z0-9]+_[a-z0-9]+', 'err_*', 'g'),
        '[0-9]+', 'N', 'g'
      ), 80)
  `;
  const topErrorsP = prisma.$queryRaw<Array<{ msg: string; count: bigint }>>`
    SELECT ${NORMALIZED_MSG} AS msg, COUNT(*) AS count
    FROM error_logs
    WHERE created_at >= ${since}
    GROUP BY ${NORMALIZED_MSG}
    ORDER BY count DESC
    LIMIT 5
  `;
  const distinctPatternsP = prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT ${NORMALIZED_MSG}) AS count
    FROM error_logs
    WHERE created_at >= ${since}
  `;
  // The tile counts every row as an "error" — but level can be warn.
  // Surfacing the split stops a wall of warns reading as 1,423 failures.
  const errByLevelP = prisma.errorLog.groupBy({
    by: ["level"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });

  // ── Backlog pressure ──
  const backlogP = Promise.all([
    prisma.captureInboxItem.count({ where: { status: "active" } }),
    // Backlog pressure must count LIVE rows only. Pre-fix this reported 52
    // inbox tasks when every INBOX row was soft-deleted (truth: 0) — the
    // operator's entire backlog signal was fictional. The brainDump /
    // reflection freshness reads below always filtered; these were missed.
    prisma.commitment.count({
      where: { status: { in: ["active", "in_progress"] }, deletedAt: null },
    }),
    prisma.task.count({ where: { status: "INBOX", deletedAt: null } }),
    prisma.brainMemory
      .findMany({
        where: {
          category: "coach_event",
          key: { startsWith: "coach:drift-recovery:" },
        },
        select: { metadata: true },
      })
      .then((rows) => {
        return rows.filter((r) => {
          const meta = (r.metadata ?? {}) as Record<string, any>;
          return !meta.ackedAt;
        }).length;
      })
      // null = read failed — "0 unacked drift alerts" on a DB error is
      // a fabricated all-clear (2026-07-30 sweep).
      .catch(() => null),
  ]);

  // ── Brain signal freshness ──
  const freshnessP = Promise.all([
    prisma.brainDump.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.reflection.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.captureInboxItem.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.brainMemory.findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
      select: { updatedAt: true },
    }).catch(() => null),
    // lastSkillExtraction read removed 2026-07-30: no /api/cron/extract-skills
    // route has ever existed and cron_job_logs has ZERO 'extract-skills' rows
    // ever — the field was permanently null and nothing rendered it.
  ]);

  // ── Law feedback loop ──
  const lawFeedbackP = Promise.all([
    prisma.situationLog.count({ where: { lawId: { not: null }, createdAt: { gte: since } } }),
    prisma.situationLog.count({
      where: { context: { startsWith: "trigger:" }, createdAt: { gte: since } },
    }),
  ]);

  // ── Vector coverage ──
  const vectorCoverageP = prisma.vectorEmbedding.groupBy({
    by: ["sourceType"],
    _count: { _all: true },
  });

  // ── Lens summary ──
  const lensP = (async () => {
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
      // null = read failed — "0 fires · 0% fallback" on a thrown query
      // rendered byte-identical to a healthy lens (2026-07-30 sweep).
      return null;
    }
  })();

  // ── VAPI voice summary (optional · null if VAPI_API_KEY unset) ──
  const voiceP = (async () => {
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

  // ── Operational rollup (2026-05-29) · the two dimensions that broke in
  //    prod (revenue $0 · evals 0/75 · bridge down) but weren't surfaced
  //    here: AI eval quality + nickstire bridge / data-source probes.
  //    Reads existing stores (eval_result + data_source_probe BrainMemory) ·
  //    no new cron. ──
  const evalAndProbesP = Promise.all([
    prisma.brainMemory
      .findFirst({
        where: { category: "eval_result", deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { metadata: true, createdAt: true },
      })
      .catch(() => null),
    prisma.brainMemory
      .findMany({
        where: { category: "data_source_probe", deletedAt: null },
        // 2026-08-19 · order by updatedAt, not createdAt. Rows are UPSERTED
        // per (probe, ET-date), so createdAt is when the row was first
        // written and updatedAt is when the probe last actually ran.
        orderBy: { updatedAt: "desc" },
        take: 40,
        // updatedAt was NOT selected before, so the reader had no way to
        // know how old a verdict was — the whole staleness class below was
        // unrepresentable. Indexed via @@index([category, updatedAt]).
        select: { key: true, content: true, updatedAt: true },
      })
      // null = read failed — an empty probe list rendered byte-identical
      // to "every data source healthy" (the apiRequestLog defect shape).
      .catch(() => null),
  ]);

  // ── Single concurrency join · every probe above runs in parallel ──
  // Total latency is now the MAX of the slowest probe, not the sum. The
  // post-processing below is pure CPU (map/reduce/JSON.parse) — it was
  // already interleaved with the awaits before; now it runs once after
  // the join, producing the exact same values.
  const [
    cronLogs,
    priorCronLogs,
    errCount,
    priorErrCount,
    topErrors,
    distinctPatternRows,
    errByLevel,
    [activeCap, pendingCommit, inboxTasks, unackDrift],
    [lastBrainDump, lastReflection, lastCapture, lastIdentityRefresh],
    [lawLogs, triggerLogs],
    vectorCoverage,
    lens,
    voice,
    [latestEval, probeRows],
  ] = await Promise.all([
    cronLogsP,
    priorCronLogsP,
    errCountP,
    priorErrCountP,
    topErrorsP,
    distinctPatternsP,
    errByLevelP,
    backlogP,
    freshnessP,
    lawFeedbackP,
    vectorCoverageP,
    lensP,
    voiceP,
    evalAndProbesP,
  ]);

  // ── Cron health · post-processing ──
  // "partial" is a DEGRADED completion (mega fan-out: some children
  // failed), not a hard failure. Counting it as failure — which a bare
  // `status !== "success"` did on both windows — meant a fan-out child
  // that merely ran slow was reported identically to a route that threw.
  const isHardFailure = (status: string) =>
    status !== "success" && status !== "partial";
  const priorCronFailureCount = priorCronLogs.filter((l) => isHardFailure(l.status)).length;
  const cronByJob = new Map<
    string,
    { success: number; partial: number; failed: number; totalMs: number }
  >();
  for (const l of cronLogs) {
    const e = cronByJob.get(l.jobName) ?? { success: 0, partial: 0, failed: 0, totalMs: 0 };
    if (l.status === "success") e.success++;
    else if (l.status === "partial") e.partial++;
    else e.failed++;
    e.totalMs += l.duration ?? 0;
    cronByJob.set(l.jobName, e);
  }
  const cronSummary = [...cronByJob.entries()].map(([jobName, s]) => ({
    jobName,
    success: s.success,
    partial: s.partial,
    failed: s.failed,
    avgMs: Math.round(s.totalMs / Math.max(s.success + s.partial + s.failed, 1)),
    healthy: s.failed === 0,
  }));

  // ── Error patterns · post-processing ──
  // Grouping happened in Postgres over the full window; COUNT() comes back
  // as bigint, which JSON.stringify throws on — coerce at the boundary.
  const topErrorPatterns = topErrors.map((r) => ({
    msg: r.msg,
    count: Number(r.count),
  }));
  const distinctPatterns = Number(distinctPatternRows[0]?.count ?? 0);
  const errorsByLevel = errByLevel
    .map((r) => ({ level: r.level, count: r._count._all }))
    .sort((a, b) => b.count - a.count);

  // ── Freshness "hours ago" helper ──
  const now = Date.now();
  const agoH = (d: Date | null | undefined) =>
    d ? Math.round((now - d.getTime()) / (60 * 60 * 1000)) : null;

  const evalMeta = (latestEval?.metadata ?? {}) as Record<string, unknown>;
  // Staleness gate (2026-07-30): eval_result has no live writer — prod
  // holds 2 fossil rows. Surface a run only when it is fresh (7d); an
  // ancient passRate rendered as current is a staleness lie.
  const evalFresh =
    latestEval != null &&
    Date.now() - latestEval.createdAt.getTime() < 7 * 24 * 3600_000;
  const evalHealth = evalFresh && latestEval
    ? {
        passRate: Math.round(Number(evalMeta.passRate ?? 0)),
        passed: Number(evalMeta.passed ?? 0),
        total: Number(evalMeta.total ?? 0),
        at: latestEval.createdAt.toISOString(),
      }
    : null;

  const seenProbe = new Set<string>();
  const probes: ProbeView[] = [];
  for (const row of probeRows ?? []) {
    let parsed: { probe?: string; kind?: string; ok?: boolean; reason?: string } = {};
    let parseFailed = false;
    try {
      parsed = JSON.parse(row.content) as typeof parsed;
    } catch {
      parseFailed = true;
    }
    const name = parsed.probe ?? row.key.replace(/_\d{4}-\d{2}-\d{2}$/, "");
    if (seenProbe.has(name)) continue; // rows are date-keyed · keep the freshest
    seenProbe.add(name);
    const ageMs = now - row.updatedAt.getTime();
    const stale = ageMs > PROBE_STALE_MS;
    // FAIL CLOSED. This was `parsed.ok !== false`, so an unparseable row
    // left `parsed` as `{}` and `undefined !== false` reported the probe
    // HEALTHY. A corrupt row was indistinguishable from a passing one, on
    // the one signal that can turn the operational banner red.
    const verdictOk = !parseFailed && parsed.ok === true;
    probes.push({
      name,
      kind: parsed.kind ?? "bridge",
      ok: verdictOk,
      stale,
      ageHours: Math.round(ageMs / 3_600_000),
      reason: parseFailed
        ? "probe row unparseable — verdict unreadable"
        : stale
          ? `last ran ${Math.round(ageMs / 3_600_000)}h ago`
          : (parsed.reason ?? null),
    });
  }
  const dataSources = probeRows === null
    ? null
    : {
        total: probes.length,
        failing: probes.filter((p) => !p.ok).length,
        bridgeFailing: probes.filter((p) => p.kind === "bridge" && !p.ok).length,
        stale: probes.filter((p) => p.stale).length,
        probes,
      };

  return {
    range: label,
    generatedAt: new Date().toISOString(),
    cron: {
      totalLogs: cronLogs.length,
      jobs: cronSummary,
      failureCount: cronSummary.reduce((s, j) => s + j.failed, 0),
      partialCount: cronSummary.reduce((s, j) => s + j.partial, 0),
    },
    errors: {
      total: errCount,
      distinctPatterns,
      byLevel: errorsByLevel,
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
    operational: {
      eval: evalHealth,
      dataSources,
    },
  };
}
