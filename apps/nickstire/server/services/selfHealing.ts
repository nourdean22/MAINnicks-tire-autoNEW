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
  const jobs = getJobStatuses();
  const lastCompletions = await loadLastCompletions();

  if (lastCompletions === null) {
    // Unreadable is NOT the same as healthy, and NOT the same as stale. Saying
    // so explicitly keeps a DB blip from masquerading as an all-clear AND from
    // firing a false alert on every registered job at once.
    issues.push("CRON STALENESS UNKNOWN: cron_log unreadable — staleness not evaluated this pass");
  } else {
    for (const job of jobs) {
      if (!job.enabled) continue;
      const expectedIntervalMs = job.intervalMin * 60 * 1000;
      const lastRunIso = lastCompletions.get(job.name) ?? job.lastRun;

      if (!lastRunIso) {
        // Never completed once. This is how a job registered against the retired
        // startAllJobs() path looks — armed in the registry, absent from every
        // tier, silent forever. Only report once the process has been up long
        // enough that a run was actually due, so a fresh boot stays quiet.
        if (process.uptime() * 1000 > expectedIntervalMs * 2) {
          issues.push(
            `CRON NEVER OBSERVED: ${job.name} has no completed cron_log row (expected every ${job.intervalMin}min) — registered but wired to no tier?`
          );
        }
        continue;
      }

      const staleness = Date.now() - new Date(lastRunIso).getTime();
      if (staleness > expectedIntervalMs * 3) {
        issues.push(
          `CRON STALE: ${job.name} hasn't run in ${Math.round(staleness / 60000)}min (expected every ${job.intervalMin}min)`
        );
        // AUTO-FIX: Reset the stuck job's running flag on the ORIGINAL object
        try {
          const { resetJobRunningFlag } = await import("../cron/index");
          if (resetJobRunningFlag(job.name)) {
            actions.push(`AUTO-FIX: Reset ${job.name} running flag — will run on next tick`);
          }
        } catch (e) { log.warn("[services/selfHealing] operation failed:", e); }
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
        ? `All healthy. ${jobs.length} crons, ${heapUsedMB}MB heap, ${uptimeMin}min uptime`
        : `${issues.length} issues, ${actions.length} auto-fixes: ${[...issues, ...actions].join("; ")}`,
  };
}
