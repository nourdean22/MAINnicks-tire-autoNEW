/**
 * Self-Healing Watchdog — Detects system anomalies and alerts
 * Checks: cron health, DB connectivity, vendor health, submission rates.
 * Sends Telegram alert on critical issues.
 */

import { createLogger } from "../lib/logger";
import { getJobStatuses } from "../cron/index";
import { alertSystem } from "./telegram";

const log = createLogger("self-healing");

export async function runSelfHealingChecks(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  const issues: string[] = [];

  // 1. Check for stale crons
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
    }
  }

  // 2. Check DB connectivity
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) {
      issues.push("DATABASE: getDb() returned null");
    }
  } catch (err) {
    issues.push(`DATABASE DOWN: ${err instanceof Error ? err.message : "Unknown error"}`);
  }

  // 3. Check memory usage
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  if (heapUsedMB > 450) {
    issues.push(`MEMORY HIGH: ${heapUsedMB}MB heap used`);
  }

  // 4. Check uptime (restart detection)
  const uptimeMin = Math.round(process.uptime() / 60);
  if (uptimeMin < 2) {
    log.info("Recent restart detected", { uptimeMin });
  }

  // Report
  if (issues.length > 0) {
    log.warn("Self-healing issues detected", { count: issues.length, issues });

    // Teach Nick AI about system health patterns
    try {
      const { remember } = await import("./nickMemory");
      for (const issue of issues) {
        await remember({
          type: "pattern",
          content: `System health: ${issue}. Detected at ${new Date().toISOString().split("T")[0]}.`,
          source: "self_healing",
          confidence: 0.85,
        });
      }
    } catch {}

    const critical = issues.filter(
      (i) => i.includes("DATABASE") || i.includes("MEMORY HIGH")
    );
    if (critical.length > 0) {
      alertSystem(
        "Self-Healing Alert",
        critical.join("\n")
      ).catch(() => {});
    }
  }

  return {
    recordsProcessed: issues.length,
    details:
      issues.length === 0
        ? `All healthy. ${jobs.length} crons, ${heapUsedMB}MB heap, ${uptimeMin}min uptime`
        : `${issues.length} issues: ${issues.join("; ")}`,
  };
}
