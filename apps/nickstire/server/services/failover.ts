/**
 * Health monitoring — is the sibling app reachable from this one.
 *
 * nickstire (this process) probes statenour-web's `/api/health` once a day
 * (`engine-health`, daily tier in `server/cron/scheduler.ts`). If statenour is
 * unreachable it records degraded mode and alerts; nickstire keeps serving
 * either way. There is no data push in this file — an earlier header claimed
 * one ("pushes critical data to Vercel"); no such code has ever existed here.
 *
 * NAMING CORRECTED 2026-09-09, and it was not cosmetic. Every field and
 * message below used to say "Vercel". The probe has always fetched
 * `STATENOUR_SYNC_URL`, which defaults to the **Railway** host — so the check
 * was pointed at the right place and only its labels were wrong. The cost sat
 * in the alert: it read "FAILOVER ALERT: Vercel (statenour-os) is unreachable
 * / Railway is running normally", so during a genuine statenour outage it sent
 * whoever was on it to a platform retired in 2026-08, while asserting the
 * platform that was actually down was fine. Vercel is gone — see
 * `apps/statenour/AGENTS.md` §1.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("failover");

interface EngineHealth {
  /** This process. Self-reported: if we are executing, we are up. */
  railway: { healthy: boolean; latencyMs: number; lastCheck: string };
  /** statenour-web, probed over HTTP. */
  statenour: { healthy: boolean; latencyMs: number; lastCheck: string };
  mode: "primary" | "degraded" | "failover";
}

let lastHealth: EngineHealth = {
  railway: { healthy: true, latencyMs: 0, lastCheck: new Date().toISOString() },
  statenour: { healthy: false, latencyMs: 0, lastCheck: "" },
  mode: "primary",
};

/**
 * Check both engines and determine operating mode.
 */
export async function checkEngineHealth(): Promise<EngineHealth> {
  const statenourUrl = process.env.STATENOUR_SYNC_URL || "https://statenour-web-production.up.railway.app";

  // Check Railway (self — if we're running, we're healthy)
  const railwayStart = Date.now();
  lastHealth.railway = {
    healthy: true,
    latencyMs: Date.now() - railwayStart,
    lastCheck: new Date().toISOString(),
  };

  // Check statenour-web (target resolves to Railway; see STATENOUR_SYNC_URL above)
  try {
    const statenourStart = Date.now();
    const res = await fetch(`${statenourUrl}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    lastHealth.statenour = {
      // The 307 allowance is inherited from the Vercel era, where a redirect to
      // an auth page was the normal response. Kept deliberately: tightening a
      // live health predicate without a production reading is how a silent
      // false-alert lane gets opened. Revisit with an actual observed status.
      healthy: res.ok || res.status === 307,
      latencyMs: Date.now() - statenourStart,
      lastCheck: new Date().toISOString(),
    };
  } catch (e) {
    log.warn("[services/failover] operation failed:", e);
    lastHealth.statenour = {
      healthy: false,
      latencyMs: -1,
      lastCheck: new Date().toISOString(),
    };
  }

  // Determine mode. NOTE: `railway.healthy` is a self-report hardcoded true
  // above, so the "failover" branch is currently unreachable by construction —
  // it needs a real liveness signal for this process before it can ever fire.
  if (lastHealth.railway.healthy && lastHealth.statenour.healthy) {
    lastHealth.mode = "primary"; // both apps reachable
  } else if (lastHealth.railway.healthy && !lastHealth.statenour.healthy) {
    lastHealth.mode = "degraded"; // nickstire up, statenour unreachable
  } else {
    lastHealth.mode = "failover";
  }

  return lastHealth;
}

/**
 * Get cached health status.
 */
export function getEngineHealth(): EngineHealth {
  return lastHealth;
}

/**
 * Run health check as a cron job.
 */
export async function runHealthCheck(): Promise<{ recordsProcessed?: number; details?: string }> {
  const health = await checkEngineHealth();

  // Alert if statenour-web is unreachable. The message must name the service
  // and host someone can actually open — an alert that names a retired
  // platform costs the responder their first minutes on the wrong system.
  if (!health.statenour.healthy) {
    try {
      const { sendTelegram } = await import("./telegram");
      const target = process.env.STATENOUR_SYNC_URL || "https://statenour-web-production.up.railway.app";
      await sendTelegram(
        `⚠️ HEALTH ALERT: statenour-web is unreachable from nickstire.\n` +
        `Probed: ${target}/api/health\n` +
        `nickstire (Railway) is serving normally; the cross-app sync lane is degraded.\n` +
        `Check the statenour-web service in Railway.`
      );
    } catch (e) { log.warn("[services/failover] operation failed:", e); }
  }

  return {
    recordsProcessed: 1,
    details: `Mode: ${health.mode} | nickstire: ${health.railway.latencyMs}ms | statenour: ${health.statenour.latencyMs}ms`,
  };
}
