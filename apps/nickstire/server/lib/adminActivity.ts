/**
 * Admin Activity Tracker
 *
 * Why this exists:
 *   ShopDriver (ALG) and AutoLabor Guide are fragile session-based integrations.
 *   When we authenticate a new probe from the server, their backend KICKS the
 *   browser session open at the actual shop counter. The shop staff then gets
 *   logged out of their ticketing screen — every 5-15 minutes — which is awful.
 *
 *   Fix: only run server-side probes when Nour is on /admin (nickstire.org or
 *   statenour). If Nour isn't actively using admin, we assume the shop is
 *   actively using their counter and we DO NOT probe.
 *
 * How it works:
 *   - Every adminProcedure call touches this tracker (server/_core/trpc.ts).
 *     That is the ONLY caller of touchAdminActivity: there is no /api/admin/ping
 *     route and no bridge hook in this repo (checked 2026-10-21; this header
 *     used to claim both).
 *   - Cron jobs that auth against ShopDriver/ALG check isAdminSessionActive()
 *     before running. If false, they skip with a "shop-protected" result.
 *   - Admin UI has a "Force Sync Now" button that bypasses the gate.
 *   - SYNC ON PAGE LOAD (Nour, 2026-10-21, "Refresh syncs anytime"): a full
 *     admin page load or refresh syncs ShopDriver through
 *     maybeFireAdminRefreshProbe, at most once per 30 minutes, at any hour.
 *     Nour accepted that each sync re-authenticates ShopDriver and logs the
 *     shop counter out. A touch alone (every click) NEVER probes. This
 *     replaced the 6 h "resume edge" rule (first touch after 6 h of silence).
 *     Other ALG syncs: 3 AM and 8 PM ET (scheduler), OAuth login, the manual
 *     refresh buttons and the Nick chat.
 *
 * Design notes:
 *   - Pure in-memory on the server. Resets on restart — safe, cron just
 *     skips for a few minutes after boot until Nour touches /admin.
 *   - Default window = 10 minutes (covers typical active use patterns).
 */

interface AdminActivityState {
  lastTouchMs: number;
  totalTouches: number;
  lastSource: string | null;
}

const state: AdminActivityState = {
  lastTouchMs: 0,
  totalTouches: 0,
  lastSource: null,
};

/**
 * Record admin activity (called by the adminProcedure middleware). It only
 * records: syncing ShopDriver on a page load is maybeFireAdminRefreshProbe,
 * called by one deliberate door, because a touch happens on every click.
 */
export function touchAdminActivity(source: string = "unknown"): void {
  state.lastTouchMs = Date.now();
  state.totalTouches++;
  state.lastSource = source;
}

// ─── ALG sync on an admin page load ───────────────────────
/**
 * DECISION, Nour, 2026-10-21 ("Refresh syncs anytime"): sync ShopDriver on every
 * admin page load or refresh, at most every 30 min, at any hour, accepting that
 * each sync re-authenticates ShopDriver and logs the shop counter out. This
 * replaced the 2026-07-28 resume-edge rule (first touch after 6 h of silence,
 * 4 h between probes), which never fired in a day of steady use.
 */
export const REFRESH_PROBE_MIN_INTERVAL_MS = 30 * 60 * 1000;
let refreshProbeInFlight = false;

/**
 * Probe outcomes that ATTEMPTED an ALG authentication — the thing that
 * kicks the shop counter's ShopDriver session. Strike-1 fix: the
 * throttle previously counted only `success`, so an `empty` probe ten
 * minutes ago (auth happened, no new records) didn't suppress the next
 * probe — repeated kicks. `dedup`/`skipped_recent` never reach
 * auth and deliberately don't count. Exported for unit tests.
 */
export const AUTH_ATTEMPTING_OUTCOMES = ["success", "empty", "auth_failed", "error"] as const;

export interface AdminRefreshProbeResult {
  /** True when this call started a probe. False: in flight already, too soon, or the log was unreadable. */
  started: boolean;
  /** Resolves when the probe and its follow-up end; never rejects. Callers that must not wait ignore it. */
  done: Promise<void>;
}

/**
 * Sync ShopDriver for a full admin page load, throttled restart-proof: start a
 * probe only when the last AUTH-ATTEMPTING probe (any reason, per
 * alg_probe_log) is at least REFRESH_PROBE_MIN_INTERVAL_MS old. The decision is
 * returned as soon as it is made; the probe runs behind it, and a failure of
 * any kind stays inside `done` and never reaches the admin request. An
 * unreadable log means "do not probe": unknown is not "due".
 *
 * shortcut: the in-process flag plus the log read is not an atomic claim. During
 * a Railway redeploy the old and new instance can both pass the read and each
 * probe once (algProbeBudget's own 30 s dedup is per process too). That costs
 * one extra counter logout per deploy at most. Upgrade to a conditional claim
 * row if alg_probe_log ever shows two admin_refresh rows inside one minute.
 */
export async function maybeFireAdminRefreshProbe(source: string): Promise<AdminRefreshProbeResult> {
  if (refreshProbeInFlight) return { started: false, done: Promise.resolve() };
  refreshProbeInFlight = true;
  let handedOff = false;
  try {
    // In-memory floor: every auth attempt THIS process started, stamped when it STARTED (the
    // budget sets lastProbeStartedAt before the probe runs, not when it logs). writeProbeLog
    // swallows insert errors, so a probe that authenticated but could not log leaves no durable
    // row, and the SQL age below would call the next load due at once (the budget's own success
    // TTL is only 5 min, and empty / auth_failed / error have none). Both ages must be 30 min.
    const { getProbeBudgetState } = await import("../services/algProbeBudget");
    const lastStartedIso = getProbeBudgetState().lastProbeStartedAt;
    if (lastStartedIso && Date.now() - new Date(lastStartedIso).getTime() < REFRESH_PROBE_MIN_INTERVAL_MS) {
      return { started: false, done: Promise.resolve() };
    }

    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return { started: false, done: Promise.resolve() };
    const { algProbeLog } = await import("../../drizzle/schema");
    const { desc, inArray, sql } = await import("drizzle-orm");
    // The age is computed IN SQL (apps/nickstire/AGENTS.md > Time): the driver hands a
    // timestamp back shifted by the ET offset, so `Date.now() - startedAt` in JS can be hours
    // off in either direction. startedAt is written by the column default (CURRENT_TIMESTAMP,
    // see algProbeBudget.writeProbeLog, which never sets it), so NOW() is the same clock.
    const [lastAuthAttempt] = await d
      .select({ ageSeconds: sql<number | null>`TIMESTAMPDIFF(SECOND, ${algProbeLog.startedAt}, NOW())` })
      .from(algProbeLog)
      .where(inArray(algProbeLog.outcome, [...AUTH_ATTEMPTING_OUTCOMES]))
      .orderBy(desc(algProbeLog.startedAt))
      .limit(1);
    if (lastAuthAttempt) {
      const ageSeconds = Number(lastAuthAttempt.ageSeconds);
      // A row whose age cannot be read is UNKNOWN, not "due": do not probe.
      if (!Number.isFinite(ageSeconds) || ageSeconds * 1000 < REFRESH_PROBE_MIN_INTERVAL_MS) {
        return { started: false, done: Promise.resolve() }; // an auth already happened recently — don't kick the counter again
      }
    }

    handedOff = true;
    const done = (async () => {
      try {
        const { requestAlgProbe } = await import("../services/algProbeBudget");
        const result = await requestAlgProbe("admin_refresh", { detail: `page-load:${source}` });
        if (result.outcome === "success") {
          // Parity with the OAuth login path — fold fresh invoices/estimates
          // into the materialized customer aggregates before the operator
          // opens the customers admin.
          const { refreshCustomerMetrics } = await import("../services/customerMetricsRefresh");
          await refreshCustomerMetrics();
        }
      } catch {
        // a failed freshness probe must never break the admin request
      } finally {
        refreshProbeInFlight = false;
      }
    })();
    return { started: true, done };
  } catch {
    return { started: false, done: Promise.resolve() };
  } finally {
    if (!handedOff) refreshProbeInFlight = false;
  }
}

/**
 * wave-181.26 · post-restart grace arm.
 *
 * Why this exists:
 *   After Railway redeploys/restarts the Express process, the in-memory
 *   state above resets — lastTouchMs goes back to 0. The pulse-tier
 *   ShopDriver/ALG mirror jobs run every 15 min and gate on
 *   isAdminSessionActive(). If no human touches /admin in the first
 *   15 minutes post-restart, those jobs skip — and invoice + estimate
 *   data stays stale for up to 30 min. Operator opens admin, sees
 *   yesterday's numbers, perceives the admin as "stale."
 *
 * Fix:
 *   Call this once on server boot. It back-dates lastTouchMs so the
 *   activity window has ~2 minutes remaining — enough for the first
 *   pulse-tier pass to run (catches the post-restart data refresh),
 *   short enough that it doesn't override the shop-protection if the
 *   operator isn't actually on /admin (after 2 min, the gate re-closes
 *   and the rest of the day operates normally).
 *
 * Tradeoff: up to 2 minutes of "false-positive admin active" after
 * every restart. Vs. up to 30 min of stale invoice/estimate data
 * on the admin dashboard until a manual touch. We accept the 2 min.
 */
export function armAdminActivityForStartup(): void {
  // 10 min window, minus 8 min already elapsed = 2 min remaining.
  state.lastTouchMs = Date.now() - 8 * 60 * 1000;
  state.totalTouches++;
  state.lastSource = "startup";
}

/**
 * Is the admin session currently active?
 * Default: active if anything touched within the last 10 minutes.
 */
export function isAdminSessionActive(windowMinutes: number = 10): boolean {
  if (state.lastTouchMs === 0) return false;
  return Date.now() - state.lastTouchMs < windowMinutes * 60 * 1000;
}

/** How many seconds since admin was last active (Infinity if never). */
export function secondsSinceAdminActive(): number {
  if (state.lastTouchMs === 0) return Infinity;
  return Math.round((Date.now() - state.lastTouchMs) / 1000);
}

/** Snapshot — for admin UI display. */
export function getAdminActivity(): {
  active: boolean;
  lastTouchMs: number;
  secondsAgo: number;
  totalTouches: number;
  lastSource: string | null;
} {
  return {
    active: isAdminSessionActive(),
    lastTouchMs: state.lastTouchMs,
    secondsAgo: secondsSinceAdminActive(),
    totalTouches: state.totalTouches,
    lastSource: state.lastSource,
  };
}

/**
 * Run a task only when the admin is active (protects shop session).
 * If inactive, returns a skip marker with reason instead of running.
 */
export async function runIfAdminActive<T>(
  task: () => Promise<T>,
  opts: { jobName: string; windowMinutes?: number } = { jobName: "job" },
): Promise<T | { skipped: true; reason: string; secondsSinceActive: number }> {
  if (!isAdminSessionActive(opts.windowMinutes ?? 10)) {
    return {
      skipped: true,
      reason: `${opts.jobName} skipped: admin inactive (protects shop ShopDriver/ALG session)`,
      secondsSinceActive: secondsSinceAdminActive(),
    };
  }
  return task();
}
