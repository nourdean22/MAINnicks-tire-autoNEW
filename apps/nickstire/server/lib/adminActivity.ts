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
 *   - Every adminProcedure call touches this tracker.
 *   - Every /admin page view pings POST /api/admin/ping which touches it.
 *   - Bridge requests from autonicks.com (via BRIDGE_API_KEY) touch it too.
 *   - Cron jobs that auth against ShopDriver/ALG check isAdminSessionActive()
 *     before running. If false, they skip with a "shop-protected" result.
 *   - Admin UI has a "Force Sync Now" button that bypasses the gate.
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

/** Record admin activity. Called by adminProcedure middleware, /admin pings, bridge calls. */
export function touchAdminActivity(source: string = "unknown"): void {
  state.lastTouchMs = Date.now();
  state.totalTouches++;
  state.lastSource = source;
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
