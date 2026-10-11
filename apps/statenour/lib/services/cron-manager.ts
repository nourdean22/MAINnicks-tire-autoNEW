/**
 * Cron job manager — logs runs, tracks health, exposes status.
 *
 * v10.0.20 · Apr 30: cron failures now also publish a durable
 * brain-bus event (`cron.failure`) so the dispatch registry can
 * route them to handlers (Telegram alert, BrainMemory write,
 * future remediation hooks). The publish is fire-and-forget — a
 * brain-bus write failure never breaks the existing CronJobLog
 * contract.
 */

import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";
import { deriveSkipReason } from "@/lib/services/cron-skip-reason";
import { HARD_FAILURE_STATUSES, isHardFailure } from "@/lib/services/cron-status";
// One counting rule for resultCount on both cron paths (08-F13): NULL only when the summary names no count.
import { TERMINAL_OK_STATUSES, deriveResultCount } from "@/lib/inngest/cron-lifecycle";

/**
 * A cron that CATCHES its own error and returns `{ ok: false }` resolves
 * its promise, so the try/catch below saw a success and filed a green row
 * — the job showed healthy on /system/crons while silently dead.
 *
 * That defect was diagnosed and patched three times route-by-route
 * (correlation-alarm, creation-spike-detect, decision-quality-drift, each
 * carrying the same explanatory comment) while ~7 routes with the identical
 * shape stayed green: ollama-model-liveness, inngest-liveness (the watchdog
 * that reports Inngest is down — and logged success doing it),
 * data-source-health, cost-slo-check, outbox-drain, nick-action-proposal,
 * relationship-picks-prewarm.
 *
 * Detecting it here fixes the whole class at once. Only an explicit boolean
 * `ok: false` counts — a missing `ok` is not a failure claim.
 */
function reportedFailureReason(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Record<string, unknown>;
  if (r.ok !== false) return null;
  const reason =
    typeof r.reason === "string" ? r.reason
    : typeof r.error === "string" ? r.error
    : null;
  return reason ?? "handler returned ok:false";
}

/**
 * v10.0.20 · brain-bus producer wiring. Publish a durable event for the
 * dispatch registry to route. Dedupe key includes minute granularity so a
 * cron firing every 2-5min that fails back-to-back doesn't spam the bus.
 *
 * v10.0.26 caveat: the bucket is computed AFTER the failure + CronJobLog
 * write, so a cron whose failure crosses a minute boundary can produce two
 * events in a row. Acceptable for the stated purpose (anti-spam, not
 * exact-once).
 */
function publishCronFailure(jobName: string, error: string, durationMs: number): void {
  const minuteBucket = Math.floor(Date.now() / 60_000);
  void import("@/lib/db/brain-bus-durable")
    .then((m) =>
      m.publishDurable(
        "cron.failure",
        "cron_run_failed",
        {
          jobName,
          error: error.slice(0, 1000),
          durationMs,
          failedAt: new Date().toISOString(),
        },
        { dedupeKey: `cron-failure:${jobName}:${minuteBucket}` },
      ),
    )
    .catch(() => {
      // Bus failure must never break cron error reporting itself.
    });
}

export async function logCronRun(
  jobName: string,
  fn: () => Promise<unknown>,
  /** heal:<attemptId> when the healer fired this run (cronHandler validates it); absent for a scheduled run. */
  triggerId?: string,
): Promise<{
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
  /** Set when the handler RESOLVED but described its own failure. The row
   *  is filed as failed; `success` stays true so the HTTP contract and the
   *  mega fan-out's child-result handling are unchanged. */
  reportedFailure?: string;
}> {
  const start = Date.now();
  // 2026-10-10 · open a `started` row FIRST, then settle that same row. A run
  // killed mid-flight (deploy restart) used to leave NO row at all; now the age
  // sweep in lib/inngest/cron-lifecycle.ts settles it to `interrupted`.
  // If this write fails, the terminal row is created instead (never lost).
  let startedId: string | null = null;
  try {
    startedId = (await prisma.cronJobLog.create({ data: { jobName, status: "started", triggerId }, select: { id: true } })).id;
  } catch (e) {
    logError("cron.manager", e, { fn: "logCronRun", jobName, lost: "started-row" }, "warn");
  }
  type Terminal = { status: string; duration: number; error?: string; resultCount?: number | null; skipReason?: string | null };
  const settle = async (data: Terminal, lost: string): Promise<void> => {
    try {
      if (startedId) await prisma.cronJobLog.update({ where: { id: startedId }, data });
      else await prisma.cronJobLog.create({ data: { ...data, jobName, triggerId } });
    } catch (e) {
      logError("cron.manager", e, { fn: "logCronRun", jobName, lost }, "warn");
    }
  };
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    const reported = reportedFailureReason(result);
    if (reported) {
      await settle(
        { status: "failed", duration: durationMs, error: reported, resultCount: deriveResultCount(result) },
        "reported-failure-row",
      );
      publishCronFailure(jobName, reported, durationMs);
      return { success: true, result, durationMs, reportedFailure: reported };
    }
    await settle(
      {
        status: "success",
        duration: durationMs,
        resultCount: deriveResultCount(result),
        skipReason: deriveSkipReason(result),
      },
      "success-row",
    );
    return { success: true, result, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    // No resultCount here on purpose: the handler THREW, so no result object
    // exists and there is no claim to record. Writing 0 would assert "ran and
    // produced nothing" about a run that produced no answer at all.
    await settle({ status: "failed", duration: durationMs, error }, "failure-row");

    publishCronFailure(jobName, error, durationMs);

    return { success: false, error, durationMs };
  }
}

export async function getCronStatus(limit = 50) {
  // 2026-10-10 · the summary used to be built from `logs` below: the newest 50
  // rows ACROSS all jobs, so a */15 job crowded every daily job out, and
  // started / interrupted / duplicate rows counted as successes. Now one row per
  // (job, terminal status) over the retained table; `logs` is the raw feed only.
  const [logs, groups] = await Promise.all([
    prisma.cronJobLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.cronJobLog.groupBy({
      by: ["jobName", "status"],
      where: { status: { in: [...TERMINAL_OK_STATUSES, ...HARD_FAILURE_STATUSES] } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
  ]);

  const byJob: Record<string, { lastRun: Date; lastStatus: string; total: number; failures: number; partials: number }> = {};
  for (const g of groups) {
    const at = g._max.createdAt;
    if (!at) continue;
    const e = (byJob[g.jobName] ??= { lastRun: at, lastStatus: g.status, total: 0, failures: 0, partials: 0 });
    if (at > e.lastRun) {
      e.lastRun = at;
      e.lastStatus = g.status;
    }
    e.total += g._count._all;
    if (isHardFailure(g.status)) e.failures += g._count._all;
    // 2026-08-20 · `partial` is in `total` but in neither ok bucket: a degraded
    // fan-out run is not a full success (mega-evening read 100% across 1,248).
    if (g.status === "partial") e.partials += g._count._all;
  }

  return {
    recentLogs: logs,
    // Every job here has >= 1 terminal row, so `total` is never 0.
    summary: Object.entries(byJob).map(([jobName, data]) => ({
      jobName,
      ...data,
      successRate: Math.round(((data.total - data.failures - data.partials) / data.total) * 100),
    })),
  };
}
