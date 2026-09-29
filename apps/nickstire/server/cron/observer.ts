/**
 * Cron Failure Observer
 *
 * The IMPROVEMENTS_2026-05-05.md audit flagged: "17 unattended cron jobs.
 * Silent failure → lost reviews/leads/follow-ups. No alerting."
 *
 * The infrastructure already exists for the hard part — every cron run
 * is recorded in `cron_log` with status='completed'|'failed'|... — so
 * this module just adds the alerting layer that was missing:
 *
 *   1. Read last few runs per job from cron_log.
 *   2. If a job's last 2+ consecutive runs failed, alert the owner via
 *      Telegram (channel='critical' = bypasses batching).
 *   3. Suppress duplicate alerts for 6 hours per job (in-memory state)
 *      so a persistent failure doesn't spam the channel.
 *
 * Wire-in: add to the tiered scheduler so it runs every 15 minutes.
 * Cost per run: one SQL query (a few hundred rows scanned, indexed by
 * job_name + completed_at).
 */

import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { sendTelegramMessage } from "../services/telegram";
import { createLogger } from "../lib/logger";
import { MANUAL_TRIGGER_STAGED } from "./registry-tier-map";
import { BUSINESS } from "@shared/business";
import {
  formatDatabaseDependencyAlert,
  formatFailureAlertGroup,
  formatResolvedAlertGroup,
  formatShapeAlertGroup,
  isCronAlertQuietHours,
} from "./alertPolicy";
import {
  classifyRun,
  LOOP_CONTRACTS,
  looksSkipped,
  undeclaredLoops,
  type LoopFinding,
  type ObservedRun,
} from "../services/loopShapeContract";

const log = createLogger("cron:observer");

/**
 * Alert dedupe, PERSISTED. Was an in-memory Map "cleared on restart", which made
 * ALERT_SUPPRESS_MS decorative: every Railway deploy reset it, so a permanently
 * failing job re-alerted on each restart. Measured 2026-08-29 - reel-pipeline and
 * higgsfield-session-keepalive were failing continuously (295 and 296 runs in 72h)
 * and the observer sent 2 alerts on each of 25 separate runs, roughly 50 delivered
 * Telegram messages in three days against a 6h window, because that day's merges
 * kept restarting the container.
 *
 * The Map stays as a per-process cache; shop_settings is the source of truth.
 */
const lastAlertAt: Map<string, number> = new Map();
const ALERT_SUPPRESS_MS = 6 * 60 * 60 * 1000; // 6 hours
const ALERT_KV_PREFIX = "cron_observer_last_alert:";
const ACTIVE_KV_PREFIX = "cron_observer_active_alert:";
const activeAlertCache = new Set<string>();

/**
 * The suppression judge. PURE, so the canary can prove BOTH directions against
 * fixtures it controls: suppressed inside the window, and - the control that
 * matters - alerting again once the window genuinely elapses. Persisting a
 * timestamp is one edit away from suppressing forever, and "it never alerted
 * again" is indistinguishable from "nothing was wrong".
 */
export function shouldAlertNow(
  lastAlertAtMs: number | null,
  nowMs: number,
  suppressMs: number = ALERT_SUPPRESS_MS,
): boolean {
  if (lastAlertAtMs === null || !Number.isFinite(lastAlertAtMs)) return true;
  return nowMs - lastAlertAtMs >= suppressMs;
}

/** Read a persisted last-alert time. Null = never alerted (or storage down). */
async function readLastAlertAt(key: string): Promise<number | null> {
  const cached = lastAlertAt.get(key);
  if (cached !== undefined) return cached;
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return null;
    const { shopSettings } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await d.select().from(shopSettings).where(eq(shopSettings.key, ALERT_KV_PREFIX + key)).limit(1);
    if (!rows.length) return null;
    const n = Number(rows[0].value);
    if (!Number.isFinite(n)) return null;
    lastAlertAt.set(key, n);
    return n;
  } catch (err) {
    // Storage down: return null so the alert still FIRES. Failing open here is
    // deliberate - an un-suppressed duplicate is recoverable, a silent outage is not.
    log.warn(`[cron-observer] could not read alert dedupe for ${key}; alerting rather than suppressing`, {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Persist a last-alert time so a restart cannot clear it. */
async function writeLastAlertAt(key: string, whenMs: number): Promise<void> {
  lastAlertAt.set(key, whenMs);
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return;
    const { shopSettings } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const k = ALERT_KV_PREFIX + key;
    const existing = await d.select().from(shopSettings).where(eq(shopSettings.key, k)).limit(1);
    if (existing.length > 0) {
      await d.update(shopSettings).set({ value: String(whenMs), updatedBy: "system" }).where(eq(shopSettings.key, k));
    } else {
      await d.insert(shopSettings).values({ key: k, value: String(whenMs), label: `cron observer last alert: ${key}`, category: "general", updatedBy: "system" });
    }
  } catch (err) {
    log.warn(`[cron-observer] could not persist alert dedupe for ${key}`, { err: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Alertmanager-style active-state ledger for one-shot resolved notices.
 * Cache is the fail-open fallback; shop_settings survives normal deploys.
 */
async function readActiveAlertKeys(): Promise<Set<string>> {
  const out = new Set(activeAlertCache);
  try {
    const d = await getDb();
    if (!d) return out;
    const { shopSettings } = await import("../../drizzle/schema");
    const { like } = await import("drizzle-orm");
    const rows = await d
      .select({ key: shopSettings.key, value: shopSettings.value })
      .from(shopSettings)
      .where(like(shopSettings.key, `${ACTIVE_KV_PREFIX}%`));
    for (const row of rows) {
      const key = String(row.key).slice(ACTIVE_KV_PREFIX.length);
      if (String(row.value) === "1") {
        out.add(key);
        activeAlertCache.add(key);
      }
    }
  } catch (err) {
    log.warn("[cron-observer] could not read active-alert state; using process cache", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}

async function writeAlertActive(key: string, active: boolean): Promise<void> {
  if (active) activeAlertCache.add(key);
  else activeAlertCache.delete(key);
  try {
    const d = await getDb();
    if (!d) return;
    const { shopSettings } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const k = ACTIVE_KV_PREFIX + key;
    const rows = await d.select().from(shopSettings).where(eq(shopSettings.key, k)).limit(1);
    if (rows.length > 0) {
      await d
        .update(shopSettings)
        .set({ value: active ? "1" : "0", updatedBy: "system" })
        .where(eq(shopSettings.key, k));
    } else if (active) {
      await d.insert(shopSettings).values({
        key: k,
        value: "1",
        label: `cron observer active alert: ${key}`,
        category: "general",
        updatedBy: "system",
      });
    }
  } catch (err) {
    log.warn(`[cron-observer] could not persist active state for ${key}`, {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
/**
 * Shape verdicts (dormant / anomalous / unknown / missing) persist for days by
 * nature, and the observer runs every 15 minutes — a 6h window would page the
 * operator 4× a day about the same dormancy. Once a day is the useful cadence.
 */
const SHAPE_ALERT_SUPPRESS_MS = 24 * 60 * 60 * 1000;
/**
 * Rows examined per loop for shape classification. Must exceed the largest
 * dormantAfterRuns in LOOP_CONTRACTS (14) plus the head run, or a long dormancy
 * could never be observed at its threshold.
 */
const SHAPE_RUNS_PER_LOOP = 20;
const CONSECUTIVE_FAILURE_THRESHOLD = 2;
/**
 * 7 days, not 24 hours.
 *
 * A once-per-day job contributes at most ONE row to a 24-hour window, so its
 * failure streak was capped at 1 and could never reach the threshold of 2. Daily
 * jobs that failed on every single run alerted zero times, forever — the only
 * failure alarm for the entire daily tier was structurally dead.
 */
const LOOKBACK_HOURS = 24 * 7;
/** Runs examined per job. Only needs to exceed the streak threshold. */
const RUNS_PER_JOB = 6;

interface JobFailureSnapshot {
  jobName: string;
  consecutiveFailures: number;
  latestError: string | null;
  latestFailureAt: Date;
}

/**
 * Fetch the last RUNS_PER_JOB runs for each distinct job_name and return the
 * jobs whose most recent runs are an unbroken failure streak.
 *
 * The per-job partition is load-bearing, not a tidiness choice — see the
 * comment on the query itself.
 */
async function fetchFailingJobs(): Promise<JobFailureSnapshot[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("database unavailable: getDb() returned null");
  }

  // Take the last RUNS_PER_JOB runs PER JOB, not the last N rows overall.
  //
  // The previous query was `ORDER BY completed_at DESC LIMIT 2000` across every
  // job at once. Production writes roughly 2,600 cron rows per day, so that
  // limit did not even span the 24-hour window it was filtering on: the
  // high-frequency jobs (every 2 minutes) consumed the entire budget and the
  // low-frequency jobs — exactly the ones a daily failure alarm exists for —
  // could fall off the end of the result set entirely and be invisible.
  //
  // Partitioning per job makes each job's history independent of how noisy its
  // neighbours are.
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const [raw] = await db.execute(sql`
    SELECT job_name AS jobName, status, error_message AS errorMessage, completed_at AS completedAt
    FROM (
      SELECT job_name, status, error_message, completed_at,
             ROW_NUMBER() OVER (PARTITION BY job_name ORDER BY completed_at DESC) AS rn
      FROM cron_log
      WHERE completed_at >= ${since}
    ) ranked
    WHERE rn <= ${RUNS_PER_JOB}
    ORDER BY job_name, completedAt DESC
  `);

  type Run = { jobName: string; status: string; errorMessage: string | null; completedAt: Date | null };
  const rows: Run[] = (raw as Array<Record<string, unknown>>).map((r) => ({
    jobName: String(r.jobName),
    status: String(r.status),
    errorMessage: r.errorMessage == null ? null : String(r.errorMessage),
    completedAt: r.completedAt ? new Date(r.completedAt as string) : null,
  }));

  const byJob = new Map<string, Run[]>();
  for (const r of rows) {
    if (!byJob.has(r.jobName)) byJob.set(r.jobName, []);
    byJob.get(r.jobName)!.push(r);
  }

  const failing: JobFailureSnapshot[] = [];
  for (const [jobName, runs] of byJob) {
    // runs are newest-first. Count consecutive failures from the head.
    let streak = 0;
    let latestError: string | null = null;
    let latestFailureAt = new Date(0);
    for (const r of runs) {
      if (r.status === "failed") {
        streak++;
        if (streak === 1) {
          latestError = r.errorMessage;
          latestFailureAt = r.completedAt ?? new Date();
        }
      } else {
        break;
      }
    }
    if (streak >= CONSECUTIVE_FAILURE_THRESHOLD) {
      failing.push({ jobName, consecutiveFailures: streak, latestError, latestFailureAt });
    }
  }
  return excludeStagedJobs(failing);
}

/**
 * Drop jobs that were DELIBERATELY taken off the scheduler.
 *
 * Found in review of PR #1996: a staged job stops writing new cron_log rows, but
 * its last rows are still failures, so the lookback keeps reading a FROZEN
 * streak as if it were current. Staging reel-pipeline and
 * higgsfield-session-keepalive would therefore have kept paging the operator
 * about them - up to 8 alerts a day between the two - for the whole lookback
 * window, which is the opposite of the alert-noise fix that staging was for.
 *
 * A staged job not running is the intended state, not an incident. Pure and
 * exported so the canary can prove BOTH that staged jobs are dropped and that
 * unstaged ones still page.
 */
export function excludeStagedJobs(failing: JobFailureSnapshot[]): JobFailureSnapshot[] {
  const staged = new Set(MANUAL_TRIGGER_STAGED.map((j) => j.name));
  return failing.filter((f) => !staged.has(f.jobName));
}

export interface CronRunRow {
  status: string;
  recordsProcessed: number | null;
  details: string | null;
  durationMs: number | null;
}

/**
 * Map a loop's newest-first cron_log rows onto the ObservedRun the shape
 * classifier judges. The contract module's caller responsibilities are honored
 * here:
 *
 *  · Deliberate skips are EXCLUDED from the dormancy streak — a loop that is
 *    switched off is not a loop that is broken.
 *  · A failed run breaks the zero streak (failure handling owns failures; the
 *    streak measures "succeeding while producing nothing").
 *  · `records_processed` is `int DEFAULT 0`, so cron_log can never express
 *    "unmeasured" — 0 is taken at face value and the skip phrasings in
 *    `looksSkipped` are the only discriminator, exactly as the contract
 *    documents.
 */
export function observedRunFromCronRows(loop: string, rows: readonly CronRunRow[]): ObservedRun | null {
  if (!rows.length) return null;
  const head = rows[0];
  let priorZeroRuns = 0;
  for (const r of rows.slice(1)) {
    if (looksSkipped(r.details)) continue;
    if (r.status !== "completed") break;
    if ((r.recordsProcessed ?? 0) > 0) break;
    priorZeroRuns++;
  }
  return {
    loop,
    details: head.details,
    produced: head.recordsProcessed ?? 0,
    succeeded: head.status === "completed",
    durationMs: head.durationMs ?? undefined,
    priorZeroRuns,
    runsInWindow: rows.length,
  };
}

/**
 * LOOP SHAPE PASS — the wiring the contract module shipped without.
 *
 * loopShapeContract declared what a healthy run of each burned-before loop
 * must PRODUCE (ROS-033: cross_sell ran `completed` and sent nothing for two
 * months), but the observer only ever asked "did it error?". This pass asks
 * the contract's question: did the number the loop exists to move actually
 * move? Judges only DECLARED contracts — inventing a contract from an
 * assumption is worse than none (the module's own doctrine) — and reports
 * undeclared loop names as coverage gaps instead.
 */
export async function runLoopShapeCheck(): Promise<{ findings: LoopFinding[]; judged: number; coverageGaps: string[] }> {
  const db = await getDb();
  if (!db) return { findings: [], judged: 0, coverageGaps: [] };

  const watched = LOOP_CONTRACTS.filter((c) => c.expectedRunsPerWeek > 0).map((c) => c.loop);
  if (!watched.length) return { findings: [], judged: 0, coverageGaps: [] };
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const [raw] = await db.execute(sql`
    SELECT job_name AS jobName, status, records_processed AS recordsProcessed,
           details, duration_ms AS durationMs
    FROM (
      SELECT job_name, status, records_processed, details, duration_ms,
             ROW_NUMBER() OVER (PARTITION BY job_name ORDER BY completed_at DESC) AS rn
      FROM cron_log
      WHERE completed_at >= ${since}
        AND job_name IN (${sql.join(watched.map((w) => sql`${w}`), sql`, `)})
    ) ranked
    WHERE rn <= ${SHAPE_RUNS_PER_LOOP}
    ORDER BY job_name, rn
  `);

  const byLoop = new Map<string, CronRunRow[]>();
  for (const r of raw as Array<Record<string, unknown>>) {
    const name = String(r.jobName);
    if (!byLoop.has(name)) byLoop.set(name, []);
    byLoop.get(name)!.push({
      status: String(r.status),
      recordsProcessed: r.recordsProcessed == null ? null : Number(r.recordsProcessed),
      details: r.details == null ? null : String(r.details),
      durationMs: r.durationMs == null ? null : Number(r.durationMs),
    });
  }

  const findings: LoopFinding[] = [];
  let judged = 0;
  for (const contract of LOOP_CONTRACTS) {
    if (contract.expectedRunsPerWeek === 0) continue; // deliberately unscheduled (cross_sell, retired)
    const rows = byLoop.get(contract.loop);
    if (!rows?.length) {
      // No run at all in the window its own schedule guarantees — the truly-dead
      // case classifyRun cannot see because there is no run to classify.
      findings.push({
        loop: contract.loop,
        verdict: "missing",
        summary: `${contract.loop} has no cron_log runs in ${LOOKBACK_HOURS / 24} days; its schedule expects about ${contract.expectedRunsPerWeek}/week.`,
        firstCheck: contract.firstCheck,
        ros: contract.ros,
        actionable: true,
      });
      judged++;
      continue;
    }
    const observed = observedRunFromCronRows(contract.loop, rows);
    if (!observed) continue;
    judged++;
    const finding = classifyRun(observed);
    if (finding.actionable) findings.push(finding);
  }

  // A loop nobody declared is a loop nobody is watching. Reported, not alerted.
  const [namesRaw] = await db.execute(sql`
    SELECT DISTINCT job_name AS jobName FROM cron_log WHERE completed_at >= ${since}
  `);
  const allNames = (namesRaw as Array<Record<string, unknown>>).map((r) => String(r.jobName));
  const coverageGaps = undeclaredLoops(allNames);

  return { findings, judged, coverageGaps };
}

/**
 * Main entry. Call on a 15-minute schedule (e.g. via the tiered
 * scheduler). Idempotent — safe to call more often if needed.
 */
export async function runCronFailureObserver(): Promise<{ recordsProcessed: number; details: string }> {
  let alertsSent = 0;
  let alertsSkipped = 0;

  try {
    const failing = await fetchFailingJobs();
    const now = Date.now();

    for (const f of failing) {
      const lastAlert = await readLastAlertAt(f.jobName);
      if (!shouldAlertNow(lastAlert, now, ALERT_SUPPRESS_MS)) {
        alertsSkipped++;
        continue;
      }

      const errorPreview = (f.latestError || "no error message logged").slice(0, 240);
      const text =
        `🚨 Cron failure: \`${f.jobName}\`\n` +
        `${f.consecutiveFailures} consecutive failures over the last ${LOOKBACK_HOURS}h\n` +
        `Latest error: ${errorPreview}\n` +
        `Last failure: ${f.latestFailureAt.toISOString()}`;

      const ok = await sendTelegramMessage(text, "critical");
      if (ok) {
        await writeLastAlertAt(f.jobName, now);
        alertsSent++;
        log.warn(`[cron-observer] alert sent for ${f.jobName} (${f.consecutiveFailures} failures)`);
      } else {
        log.error(`[cron-observer] failed to send Telegram alert for ${f.jobName}`);
      }
    }

    // SHAPE PASS · isolated so a shape-query failure can never mask a
    // failure-streak alert (and vice versa).
    let shapeSummary = "shapes: unavailable";
    try {
      const { findings, judged, coverageGaps } = await runLoopShapeCheck();
      let shapeAlerts = 0;
      for (const f of findings) {
        const key = `${f.loop}:${f.verdict}`;
        const lastAlert = await readLastAlertAt(`shape:${key}`);
        if (!shouldAlertNow(lastAlert, now, SHAPE_ALERT_SUPPRESS_MS)) continue;
        const text =
          `📉 Loop shape: \`${f.loop}\` → ${f.verdict}${f.ros ? ` (${f.ros})` : ""}\n` +
          `${f.summary}\n` +
          `First check: ${f.firstCheck.slice(0, 400)}`;
        const ok = await sendTelegramMessage(text, "critical");
        if (ok) {
          await writeLastAlertAt(`shape:${key}`, now);
          shapeAlerts++;
          log.warn(`[cron-observer] shape alert sent for ${f.loop} (${f.verdict})`);
        } else {
          log.error(`[cron-observer] failed to send shape alert for ${f.loop}`);
        }
      }
      // The verdict summary lands in this run's cron_log details row, so shape
      // history is persisted for free by the scheduler's own bookkeeping.
      shapeSummary = `shapes: ${findings.length} actionable of ${judged} judged (${findings.map((f) => `${f.loop}=${f.verdict}`).join(", ") || "all in-spec"}); alerts: ${shapeAlerts}; undeclared loops: ${coverageGaps.length}`;
    } catch (shapeErr) {
      shapeSummary = `shapes: ERROR ${shapeErr instanceof Error ? shapeErr.message : String(shapeErr)}`;
      log.error("[cron-observer] loop shape pass failed:", shapeErr instanceof Error ? shapeErr.message : shapeErr);
    }

    return {
      recordsProcessed: alertsSent,
      details: `scanned: ${failing.length} failing jobs; alerts sent: ${alertsSent}; suppressed (recent): ${alertsSkipped}; ${shapeSummary}`,
    };
  } catch (err) {
    log.error("[cron-observer] run failed:", err instanceof Error ? err.message : err);
    throw err;
  }
}
