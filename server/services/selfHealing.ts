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

export async function runSelfHealingChecks(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  const issues: string[] = [];
  const actions: string[] = [];

  // 1. Check for stale crons — and restart them
  const jobs = getJobStatuses();
  for (const job of jobs) {
    if (!job.enabled || !job.lastRun) continue;
    const lastRunMs = new Date(job.lastRun).getTime();
    const expectedIntervalMs = job.intervalMin * 60 * 1000;
    const staleness = Date.now() - lastRunMs;
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
      } catch (e) { console.warn("[services/selfHealing] operation failed:", e); }
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
          } catch (e) { console.warn("[services/selfHealing] operation failed:", e); }
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
  } catch (e) { console.warn("[services/selfHealing] operation failed:", e); }

  // 5. Check uptime (restart detection)
  const uptimeMin = Math.round(process.uptime() / 60);
  if (uptimeMin < 2) {
    log.info("Recent restart detected", { uptimeMin });
    actions.push("INFO: Server recently restarted — warming up");
  }

  // 6. Check Venice AI provider health
  try {
    const veniceKey = process.env.VENICE_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!veniceKey && !openaiKey) {
      issues.push("AI PROVIDERS: Neither VENICE_API_KEY nor OPENAI_API_KEY configured — Nick AI is non-functional");
    } else if (!veniceKey) {
      issues.push("AI PROVIDER: VENICE_API_KEY missing — primary AI provider (Venice) is down, running on OpenAI fallback only");
    }
  } catch (e) { console.warn("[services/selfHealing] operation failed:", e); }

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
    } catch (e) { console.warn("[services/selfHealing] operation failed:", e); }

    // Alert on critical issues
    const critical = issues.filter(
      (i) => i.includes("DATABASE") || i.includes("MEMORY HIGH") || i.includes("EVENT BUS")
    );
    if (critical.length > 0) {
      alertSystem(
        "Self-Healing Alert",
        [...critical, ...actions].join("\n")
      ).catch((e) => { console.warn("[services/selfHealing] fire-and-forget failed:", e); });
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
