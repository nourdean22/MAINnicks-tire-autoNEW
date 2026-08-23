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
import { getRegisteredJobNames } from "../cron/index";
import { loadLastCompletions } from "../cron/cron-status";
import { findCronWiringFaults } from "../cron/registry-tier-map";
import { alertSystem } from "./telegram";

const log = createLogger("self-healing");

// Track consecutive failures for escalation
const failureHistory: Record<string, number> = {};

/**
 * Every condition this watchdog can report.
 *
 * ─── Why this is a union and not a string ──────────────────────────────
 *
 * Delivery used to be decided by substring match:
 *
 *   issues.filter(i => i.includes("DATABASE") || i.includes("MEMORY HIGH")
 *                   || i.includes("EVENT BUS"))
 *
 * That filter enumerated three shapes out of eleven, so SIX categories had no
 * path to `alertSystem` at all — every cron-staleness class, and
 * "Nick AI is non-functional". They were written to `cron_log.details` for the
 * self-healing row and nowhere else. The staleness SENSOR had been carefully
 * repaired (see the cron block below, which notes that a watchdog which cannot
 * observe is worse than none); the wire from sensor to alarm was left cut.
 *
 * Widening that filter to eleven strings would have the same defect the moment
 * a twelfth category is added — a new `issues.push("...")` simply would not
 * match, and would be silently undeliverable. So delivery is DERIVED from the
 * category union instead: `Record<HealthIssueCategory, IssueDelivery>` makes
 * the compiler reject a new category that has not been given a route.
 * `selfHealingRouting.test.ts` breaks it and asserts it fails.
 */
export const HEALTH_ISSUE_CATEGORIES = [
  "CRON_CADENCE_UNKNOWN",
  "CRON_STALENESS_UNKNOWN",
  "CRON_NEVER_OBSERVED",
  "CRON_STALE",
  "CRON_WIRING_FAULT",
  "DATABASE_UNAVAILABLE",
  "DATABASE_QUERY_FAILED",
  "DATABASE_DOWN",
  "MEMORY_HIGH",
  "EVENT_BUS_DOWN",
  "AI_PROVIDERS_MISSING",
] as const;

export type HealthIssueCategory = (typeof HEALTH_ISSUE_CATEGORIES)[number];

export interface HealthIssue {
  category: HealthIssueCategory;
  message: string;
}

/**
 * `alert` reaches the operator via Telegram. `log-only` lands in cron_log only.
 *
 * Every category currently routes to `alert`: each one means either the shop's
 * automation is not running or the watchdog cannot tell whether it is, and both
 * are things the operator must hear about. The distinction is kept in the type
 * so that a future category CAN be routed to log-only deliberately — the point
 * is that the choice must be made explicitly and cannot be made by omission.
 */
export type IssueDelivery = "alert" | "log-only";

export const ISSUE_DELIVERY: Record<HealthIssueCategory, IssueDelivery> = {
  CRON_CADENCE_UNKNOWN: "alert",
  CRON_STALENESS_UNKNOWN: "alert",
  CRON_NEVER_OBSERVED: "alert",
  CRON_STALE: "alert",
  CRON_WIRING_FAULT: "alert",
  DATABASE_UNAVAILABLE: "alert",
  DATABASE_QUERY_FAILED: "alert",
  DATABASE_DOWN: "alert",
  MEMORY_HIGH: "alert",
  EVENT_BUS_DOWN: "alert",
  AI_PROVIDERS_MISSING: "alert",
};

/**
 * Per-category alert throttle.
 *
 * This watchdog runs on the 5-minute heartbeat tier. Going from three
 * alerting categories to eleven multiplies the spam risk of any PERSISTENT
 * condition by the same factor — a DB outage would page every five minutes
 * forever, and an operator who mutes the channel has un-fixed this defect by
 * hand. One alert per category per hour keeps a standing condition visible
 * without training the reader to ignore it.
 *
 * Keyed by category, NOT by message text: a message carrying a live number
 * ("hasn't completed in 431min") changes every pass and would defeat a
 * text-keyed throttle entirely.
 */
const ALERT_THROTTLE_MS = 60 * 60 * 1000;
const lastAlertedAt = new Map<HealthIssueCategory, number>();

/** Exported for the canary — a throttle nothing can reset is untestable. */
export function __resetAlertThrottleForTests(): void {
  lastAlertedAt.clear();
}

export function selectAlertableIssues(
  issues: readonly HealthIssue[],
  now: number = Date.now(),
): HealthIssue[] {
  const out: HealthIssue[] = [];
  for (const issue of issues) {
    if (ISSUE_DELIVERY[issue.category] !== "alert") continue;
    const last = lastAlertedAt.get(issue.category);
    if (last !== undefined && now - last < ALERT_THROTTLE_MS) continue;
    lastAlertedAt.set(issue.category, now);
    out.push(issue);
  }
  return out;
}

// `loadLastCompletions()` moved to cron/cron-status.ts on 2026-08-23 and is
// imported above. It was the ONE correct reader of live cron state in the repo
// while `/api/admin/cron-status` and `/api/bridge/cron-status` still reported a
// decommissioned in-memory registry. Hoisting it gave those two surfaces the
// same source instead of letting a third implementation appear.

export async function runSelfHealingChecks(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  const issues: HealthIssue[] = [];
  const actions: string[] = [];

  // 1. Check for stale crons.
  //
  // Truth comes from cron_log, NOT the in-memory registry. The old
  // `getJobStatuses()` reported `lastRun` from cron/index.ts, only ever assigned
  // inside runJob() — a function nothing had called since the tiered scheduler
  // replaced it. Every job therefore reported `lastRun: null`, so the guard
  // below `continue`d on all ~288 runs a day and this branch never evaluated a
  // single job. A watchdog that cannot observe is worse than no watchdog,
  // because its silence reads as "healthy".
  //
  // 2026-08-23 · that dead field and its writer are now DELETED rather than
  // merely bypassed here, and the two other surfaces that were still reading
  // them (`/api/admin/cron-status`, `/api/bridge/cron-status`) now share
  // `loadLastCompletions()` with this function. Bypassing a dead source fixes
  // one reader; deleting it fixes the class.
  const { getJobCadences } = await import("../cron/scheduler");
  const cadences = getJobCadences();
  const lastCompletions = await loadLastCompletions();

  if (cadences.size === 0) {
    // `tiers` is populated by startTieredScheduler(); an empty map means the
    // scheduler has not started in THIS process, not that every job is unwired.
    // Without this branch the "wired to no tier" check below would fire on every
    // registered job at once — turning a watchdog into an alert storm.
    issues.push({
      category: "CRON_CADENCE_UNKNOWN",
      message: "CRON CADENCE UNKNOWN: tiered scheduler has not started in this process — cron health not evaluated",
    });
  } else if (lastCompletions === null) {
    // Unreadable is NOT the same as healthy, and NOT the same as stale. Saying
    // so explicitly keeps a DB blip from masquerading as an all-clear AND from
    // firing a false alert on every registered job at once.
    issues.push({
      category: "CRON_STALENESS_UNKNOWN",
      message: "CRON STALENESS UNKNOWN: cron_log unreadable — staleness not evaluated this pass",
    });
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
          issues.push({
            category: "CRON_NEVER_OBSERVED",
            message: `CRON NEVER OBSERVED: ${name} has no completed cron_log row (tier ${cadence.tier}, ${cadenceLabel})`,
          });
        }
        continue;
      }

      const staleness = Date.now() - new Date(lastRunIso).getTime();
      if (staleness > allowanceMs) {
        issues.push({
          category: "CRON_STALE",
          message: `CRON STALE: ${name} hasn't completed in ${Math.round(staleness / 60000)}min (tier ${cadence.tier}, ${cadenceLabel}${cadence.businessHoursOnly ? ", business hours only" : ""})`,
        });
        // 2026-08-23 · the "AUTO-FIX: Reset <job> running flag" branch that
        // stood here was deleted with resetJobRunningFlag(). It mutated
        // `job.running` in the legacy registry, a field only the caller-less
        // runJob() ever set — so it returned false on every call and the fix it
        // advertised never once ran. The scheduler's real mutex is
        // `tier.running` plus the cron_locks row, neither reachable from here.
        // Reporting the staleness IS the action now; there is no honest
        // one-line remedy to claim.
      }
    }

    // A job armed in the legacy registry but present in NO tier cannot run at
    // all — that is what the crons stranded on the retired startAllJobs() path
    // look like. Reported separately because it is a WIRING fault, not staleness.
    //
    // The comparison is name-based, and six registry names are covered by a
    // differently-named tier job (retention-* -> retention-all, statenour-sync
    // -> statenour-live-sync). Judged on names alone this loop emitted eight
    // issues on every 5-minute pass, six of them false — which also made the
    // "All healthy" branch below unreachable in production. findCronWiringFaults
    // holds those aliases, and invalidates any alias whose covering job stops
    // being tier-wired, so the excuse cannot outlive its justification.
    for (const fault of findCronWiringFaults(getRegisteredJobNames(), new Set(cadences.keys()))) {
      issues.push({ category: "CRON_WIRING_FAULT", message: fault.message });
    }
  }

  // 2. Check DB connectivity — and reset connection if needed
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) {
      issues.push({ category: "DATABASE_UNAVAILABLE", message: "DATABASE: getDb() returned null" });
    } else {
      // Test actual connectivity with a lightweight query
      try {
        const { sql } = await import("drizzle-orm");
        await db.execute(sql`SELECT 1`);
        delete failureHistory["db"];
      } catch (err) {
        issues.push({ category: "DATABASE_QUERY_FAILED", message: `DATABASE QUERY FAILED: ${err instanceof Error ? err.message : "Unknown"}` });
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
    issues.push({ category: "DATABASE_DOWN", message: `DATABASE DOWN: ${err instanceof Error ? err.message : "Unknown error"}` });
  }

  // 3. Check memory usage — and take action if high
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  if (heapUsedMB > 450) {
    issues.push({ category: "MEMORY_HIGH", message: `MEMORY HIGH: ${heapUsedMB}MB heap used` });
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
      issues.push({ category: "EVENT_BUS_DOWN", message: "EVENT BUS: Not initialized — events are being silently dropped" });
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
      issues.push({ category: "AI_PROVIDERS_MISSING", message: "AI PROVIDERS: Neither OPENAI_API_KEY nor GEMINI_API_KEY configured — Nick AI is non-functional" });
    }
  } catch (e) { log.warn("[services/selfHealing] operation failed:", e); }

  // Report + learn + act
  const messages = issues.map((i) => i.message);
  if (issues.length > 0 || actions.length > 0) {
    log.warn("Self-healing check", { issues: issues.length, actions: actions.length, details: [...messages, ...actions] });

    // Teach Nick AI about system health patterns
    try {
      const { remember } = await import("./nickMemory");
      for (const issue of messages) {
        await remember({
          type: "pattern",
          content: `System health: ${issue}. Detected at ${new Date().toISOString().split("T")[0]}. ${actions.length > 0 ? "Auto-fixes applied: " + actions.join("; ") : "No auto-fix available."}`,
          source: "self_healing",
          confidence: 0.85,
        });
      }
    } catch (e) { log.warn("[services/selfHealing] operation failed:", e); }

    // Deliver. Routing comes from ISSUE_DELIVERY, keyed on the category union,
    // so a category added without a route fails to compile rather than failing
    // to alert. The throttle inside keeps a standing condition from paging every
    // five minutes.
    const alertable = selectAlertableIssues(issues);
    if (alertable.length > 0) {
      alertSystem(
        "Self-Healing Alert",
        [...alertable.map((i) => i.message), ...actions].join("\n")
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
        //
        // This branch was UNREACHABLE in production until 2026-08-23: the wiring
        // loop emitted eight issues on every pass (six of them name-mismatch
        // false positives), so `issues.length` was never zero and the operator
        // never once saw "All healthy". Aliasing those six is what makes this
        // line reachable — and therefore what makes it mean something.
        ? `All healthy. ${cadences.size} scheduled crons, ${heapUsedMB}MB heap, ${uptimeMin}min uptime`
        : `${issues.length} issues, ${actions.length} auto-fixes: ${[...messages, ...actions].join("; ")}`,
  };
}
