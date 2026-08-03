/**
 * Self-Healing Watchdog — Detects AND FIXES system anomalies.
 *
 * Not just alerting — actually takes corrective action:
 * - Stale crons → restart them
 * - High memory → trigger GC and clear caches
 * - DB down → reset connection
 * - Event bus silent → re-initialize
 * - Vendor APIs down → switch to fallback
 */

import { createLogger } from "../lib/logger";
import { getJobStatuses } from "../cron/index";
import { alertSystem } from "./telegram";

const log = createLogger("self-healing");

// Track consecutive failures for escalation
const failureHistory: Record<string, number> = {};

/**
 * Last successful completion per job name, read from cron_log — the only record
 * that actually reflects whether a job ran.
 *
 * Returns null when the log cannot be read. Callers MUST treat null as "cannot
 * tell", never as "nothing ran": an empty map would make every registered job
 * look permanently silent and fire an alert for all of them on a transient DB
 * fault. Same shape as the failure observer's query in cron/observer.ts.
 */
async function loadLastCompletions(): Promise<Map<string, string> | null> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return null;
    const { sql } = await import("drizzle-orm");
    const [raw] = await db.execute(sql`
      SELECT job_name AS jobName, MAX(completed_at) AS lastCompletedAt
      FROM cron_log
      WHERE status = 'completed' AND completed_at IS NOT NULL
      GROUP BY job_name
    `);
    const out = new Map<string, string>();
    for (const row of raw as Array<Record<string, unknown>>) {
      const at = row.lastCompletedAt;
      if (at == null) continue;
      const parsed = at instanceof Date ? at : new Date(String(at));
      if (!Number.isNaN(parsed.getTime())) out.set(String(row.jobName), parsed.toISOString());
    }
    return out;
  } catch (err) {
    log.warn("[self-healing] cron_log completion read failed:", err);
    return null;
  }
}

export async function runSelfHealingChecks(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  const issues: string[] = [];
  const actions: string[] = [];

  // 1. Check for stale crons — and restart them
  //
  // Truth comes from cron_log, NOT the in-memory registry. `getJobStatuses()`
  // reports `lastRun` from cron/index.ts, which is only ever assigned inside
  // runJob() — a function nothing has called since the tiered scheduler replaced
  // it. Every job therefore reported `lastRun: null`, so the guard below
  // `continue`d on all ~288 runs a day and this branch has never evaluated a
  // single job. A watchdog that cannot observe is worse than no watchdog,
  // because its silence reads as "healthy".
  const { getJobCadences } = await import("../cron/scheduler");
  const cadences = getJobCadences();
  const lastCompletions = await loadLastCompletions();

  if (cadences.size === 0) {
    // `tiers` is populated by startTieredScheduler(); an empty map means the
    // scheduler has not started in THIS process, not that every job is unwired.
    // Without this branch the "wired to no tier" check below would fire on every
    // registered job at once — turning a watchdog into an alert storm.
    issues.push("CRON CADENCE UNKNOWN: tiered scheduler has not started in this process — cron health not evaluated");
  } else if (lastCompletions === null) {
    // Unreadable is NOT the same as healthy, and NOT the same as stale. Saying
    // so explicitly keeps a DB blip from masquerading as an all-clear AND from
    // firing a false alert on every registered job at once.
    issues.push("CRON STALENESS UNKNOWN: cron_log unreadable — staleness not evaluated this pass");
  } else {
    // Cadence comes from the TIER that owns each job, never from the legacy
    // registry's own intervalMin — those numbers no longer describe reality
    // (review-monitor declares 6h but runs daily, sms-scheduler declares 5min
    // but runs in the 15min tier), so comparing against them reports healthy
    // jobs as stale on every 5-minute pass.
    for (const [name, cadence] of cadences) {
      // ROS-081 · a `oncePerShopDay` job sits in the 2h tier so it gets enough
      // chances to land inside business hours, but it deliberately runs ONCE a
      // day. Judged on the raw tier interval it would be "stale" after ~21h
      // (120min x3 + overnight grace) against a perfectly normal ~24h gap —
      // a daily false alert that also auto-reset the job's running flag. Give
      // it an explicit two-shop-day allowance instead of the x3 heuristic:
      // tight enough to catch a genuinely dead daily loop on the second miss,
      // loose enough that a healthy 24h gap never fires.
      //
      // A businessHoursOnly job is SUPPOSED to be silent overnight. Without
      // that grace the watchdog alerts on every one of them, every night.
      const overnightGraceMs = cadence.businessHoursOnly ? 15 * 60 * 60 * 1000 : 0;
      const allowanceMs = cadence.oncePerShopDay
        ? 48 * 60 * 60 * 1000
        : cadence.intervalMin * 60 * 1000 * 3 + overnightGraceMs;
      // Report the cadence the job actually keeps, not the tier's raw tick —
      // "every 120min" on a once-a-day job sends the reader to the wrong bug.
      const cadenceLabel = cadence.oncePerShopDay
        ? "once per shop day"
        : `every ${cadence.intervalMin}min`;
      const lastRunIso = lastCompletions.get(name);

      if (!lastRunIso) {
        // Never completed once. Only report after the process has been up long
        // enough that a run was genuinely due, so a fresh boot stays quiet.
        if (process.uptime() * 1000 > allowanceMs) {
          issues.push(
            `CRON NEVER OBSERVED: ${name} has no completed cron_log row (tier ${cadence.tier}, ${cadenceLabel})`
          );
        }
        continue;
      }

      const staleness = Date.now() - new Date(lastRunIso).getTime();
      if (staleness > allowanceMs) {
        issues.push(
          `CRON STALE: ${name} hasn't completed in ${Math.round(staleness / 60000)}min (tier ${cadence.tier}, ${cadenceLabel}${cadence.businessHoursOnly ? ", business hours only" : ""})`
        );
        // AUTO-FIX: Reset the stuck job's running flag on the ORIGINAL object
        try {
          const { resetJobRunningFlag } = await import("../cron/index");
          if (resetJobRunningFlag(name)) {
            actions.push(`AUTO-FIX: Reset ${name} running flag — will run on next tick`);
          }
        } catch (e) { log.warn("[services/selfHealing] operation failed:", e); }
      }
    }

    // A job armed in the legacy registry but present in NO tier cannot run at
    // all — that is what the crons stranded on the retired startAllJobs() path
    // look like. Reported separately because it is a WIRING fault, not staleness.
    for (const job of getJobStatuses()) {
      if (job.enabled && !cadences.has(job.name)) {
        issues.push(`CRON WIRED TO NO TIER: ${job.name} is enabled in the registry but belongs to no scheduler tier — it cannot run`);
      }
    }
  }

  // 2. Check DB connectivity — and reset connection if needed
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) {
      issues.push("DATABASE: getDb() returned null");
    } else {
      // Test actual connectivity with a lightweight query
      try {
        const { sql } = await import("drizzle-orm");
        await db.execute(sql`SELECT 1`);
        delete failureHistory["db"];
      } catch (err) {
        issues.push(`DATABASE QUERY FAILED: ${err instanceof Error ? err.message : "Unknown"}`);
        failureHistory["db"] = (failureHistory["db"] || 0) + 1;
        // AUTO-FIX: Reset the cached connection on 2+ consecutive failures
        if (failureHistory["db"] >= 2) {
          try {
            const { resetDbConnection } = await import("../db");
            resetDbConnection();
            actions.push("AUTO-FIX: Reset DB connection — will reconnect on next query");
          } catch (e) { log.warn("[services/selfHealing] operation failed:", e); }
        }
      }
    }
  } catch (err) {
    issues.push(`DATABASE DOWN: ${err instanceof Error ? err.message : "Unknown error"}`);
  }

  // 3. Check memory usage — and take action if high
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  if (heapUsedMB > 450) {
    issues.push(`MEMORY HIGH: ${heapUsedMB}MB heap used`);
    // AUTO-FIX: Trigger garbage collection if available
    if (global.gc) {
      global.gc();
      actions.push("AUTO-FIX: Triggered manual garbage collection");
    }
  }

  // 4. Check event bus health — is it actually dispatching?
  try {
    const { getEventBusStatus } = await import("./eventBus");
    const busStatus = getEventBusStatus();
    if (!busStatus.initialized) {
      issues.push("EVENT BUS: Not initialized — events are being silently dropped");
    }
  } catch (e) { log.warn("[services/selfHealing] operation failed:", e); }

  // 5. Check uptime (restart detection)
  const uptimeMin = Math.round(process.uptime() / 60);
  if (uptimeMin < 2) {
    log.info("Recent restart detected", { uptimeMin });
    actions.push("INFO: Server recently restarted — warming up");
  }

  // 6. Check AI provider health.
  // Only raise as an ISSUE when neither GEMINI_API_KEY nor OPENAI_API_KEY is configured
  // (Nick AI genuinely non-functional).
  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!openaiKey && !geminiKey) {
      issues.push("AI PROVIDERS: Neither OPENAI_API_KEY nor GEMINI_API_KEY configured — Nick AI is non-functional");
    }
  } catch (e) { log.warn("[services/selfHealing] operation failed:", e); }

  // Report + learn + act
  if (issues.length > 0 || actions.length > 0) {
    log.warn("Self-healing check", { issues: issues.length, actions: actions.length, details: [...issues, ...actions] });

    // Teach Nick AI about system health patterns
    try {
      const { remember } = await import("./nickMemory");
      for (const issue of issues) {
        await remember({
          type: "pattern",
          content: `System health: ${issue}. Detected at ${new Date().toISOString().split("T")[0]}. ${actions.length > 0 ? "Auto-fixes applied: " + actions.join("; ") : "No auto-fix available."}`,
          source: "self_healing",
          confidence: 0.85,
        });
      }
    } catch (e) { log.warn("[services/selfHealing] operation failed:", e); }

    // Alert on critical issues
    const critical = issues.filter(
      (i) => i.includes("DATABASE") || i.includes("MEMORY HIGH") || i.includes("EVENT BUS")
    );
    if (critical.length > 0) {
      alertSystem(
        "Self-Healing Alert",
        [...critical, ...actions].join("\n")
      ).catch((e) => { log.warn("[services/selfHealing] fire-and-forget failed:", e); });
    }
  }

  return {
    recordsProcessed: issues.length + actions.length,
    details:
      issues.length === 0 && actions.length === 0
        // Count the jobs the TIERS own — i.e. the ones that can actually run.
        // The legacy registry count included crons wired to no tier, so the
        // "all healthy" line used to overstate how much was really covered.
        ? `All healthy. ${cadences.size} scheduled crons, ${heapUsedMB}MB heap, ${uptimeMin}min uptime`
        : `${issues.length} issues, ${actions.length} auto-fixes: ${[...issues, ...actions].join("; ")}`,
  };
}
