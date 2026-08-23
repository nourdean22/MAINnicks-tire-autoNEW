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
 * The countable result a handler explicitly claims, or null.
 *
 * Same rule as reportedFailureReason above, and for the same reason: ONLY AN
 * EXPLICIT CLAIM COUNTS. A handler that returns no `resultCount` gets NULL, never
 * 0 — because "produced nothing" and "did not say" are different facts, and
 * cron_job_logs previously could represent neither.
 *
 * That distinction is the whole point of the column. `ingest-reviews` ran 4x/day
 * for 16 days with a 100% failure rate (64 runs, 64 failures) and nothing could
 * tell a full ingest from an empty one, because the table had no place to put the
 * number. Defaulting a missing count to 0 here would re-manufacture exactly the
 * fabrication the nullable column was chosen to avoid.
 */
function countFrom(result: unknown): number | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Record<string, unknown>;
  // Number.isFinite is NOT enough. It admits 2.5, -1, and 1e12 — none of which a
  // Postgres INTEGER can store. Any of them reaches prisma.cronJobLog.create, is
  // rejected, and lands in the .catch below, which logs a warning and drops the
  // write. The row does not arrive with a NULL count; THE WHOLE ROW DISAPPEARS.
  // That is a strictly worse version of the condition this column exists to end:
  // a cron run with no trace in the monitoring table. Not reachable from today's
  // only producer (ingest-reviews passes an integer), but countFrom is deliberately
  // generic, and the next handler returning a rate or an average would trip it.
  const v = r.resultCount;
  return typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= 2147483647
    ? v
    : null;
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
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    const reported = reportedFailureReason(result);
    if (reported) {
      await prisma.cronJobLog.create({
        data: { jobName, status: "failed", duration: durationMs, error: reported, resultCount: countFrom(result) },
      }).catch((e) => logError("cron.manager", e, { fn: "logCronRun", jobName, lost: "reported-failure-row" }, "warn"));
      publishCronFailure(jobName, reported, durationMs);
      return { success: true, result, durationMs, reportedFailure: reported };
    }
    await prisma.cronJobLog.create({
      data: { jobName, status: "success", duration: durationMs, resultCount: countFrom(result) },
    }).catch((e) => logError("cron.manager", e, { fn: "logCronRun", jobName, lost: "success-row" }, "warn"));
    return { success: true, result, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    await prisma.cronJobLog.create({
      // No resultCount here on purpose: the handler THREW, so no result object
      // exists and there is no claim to record. Writing 0 would assert "ran and
      // produced nothing" about a run that produced no answer at all.
      data: { jobName, status: "failed", duration: durationMs, error },
    }).catch((e) => logError("cron.manager", e, { fn: "logCronRun", jobName, lost: "failure-row" }, "warn"));

    publishCronFailure(jobName, error, durationMs);

    return { success: false, error, durationMs };
  }
}

export async function getCronStatus(limit = 50) {
  const logs = await prisma.cronJobLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // Group by jobName — get last run + success rate
  const byJob: Record<string, { lastRun: Date; lastStatus: string; total: number; failures: number; partials: number }> = {};
  for (const log of logs) {
    if (!byJob[log.jobName]) {
      byJob[log.jobName] = { lastRun: log.createdAt, lastStatus: log.status, total: 0, failures: 0, partials: 0 };
    }
    byJob[log.jobName].total++;
    if (log.status === "failed") byJob[log.jobName].failures++;
    // 2026-08-20 · `partial` is in `total` but was in neither bucket, so the
    // old `(total - failures) / total` scored every degraded fan-out run as a
    // full success: mega-evening read 100% across 1,248 partial runs.
    if (log.status === "partial") byJob[log.jobName].partials++;
  }

  return {
    recentLogs: logs,
    summary: Object.entries(byJob).map(([jobName, data]) => ({
      jobName,
      ...data,
      successRate:
        data.total > 0
          ? Math.round(((data.total - data.failures - data.partials) / data.total) * 100)
          : 100,
    })),
  };
}
