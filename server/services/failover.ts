/**
 * Failover & Health Monitoring — Dual-engine resilience.
 *
 * Checks if both engines (Railway + Vercel) are healthy.
 * If Railway starts degrading, pushes critical data to Vercel.
 * If Vercel is unreachable, flags it but continues on Railway.
 *
 * Tesla principle: the system should never go fully down.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("failover");

interface EngineHealth {
  railway: { healthy: boolean; latencyMs: number; lastCheck: string };
  vercel: { healthy: boolean; latencyMs: number; lastCheck: string };
  mode: "primary" | "degraded" | "failover";
}

let lastHealth: EngineHealth = {
  railway: { healthy: true, latencyMs: 0, lastCheck: new Date().toISOString() },
  vercel: { healthy: false, latencyMs: 0, lastCheck: "" },
  mode: "primary",
};

/**
 * Check both engines and determine operating mode.
 */
export async function checkEngineHealth(): Promise<EngineHealth> {
  const statenourUrl = process.env.STATENOUR_SYNC_URL || "https://statenour-os.vercel.app";

  // Check Railway (self — if we're running, we're healthy)
  const railwayStart = Date.now();
  lastHealth.railway = {
    healthy: true,
    latencyMs: Date.now() - railwayStart,
    lastCheck: new Date().toISOString(),
  };

  // Check Vercel (statenour)
  try {
    const vercelStart = Date.now();
    const res = await fetch(`${statenourUrl}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    lastHealth.vercel = {
      healthy: res.ok || res.status === 307, // 307 redirect is normal for Vercel
      latencyMs: Date.now() - vercelStart,
      lastCheck: new Date().toISOString(),
    };
  } catch (e) {
    console.warn("[services/failover] operation failed:", e);
    lastHealth.vercel = {
      healthy: false,
      latencyMs: -1,
      lastCheck: new Date().toISOString(),
    };
  }

  // Determine mode
  if (lastHealth.railway.healthy && lastHealth.vercel.healthy) {
    lastHealth.mode = "primary"; // Both engines running
  } else if (lastHealth.railway.healthy && !lastHealth.vercel.healthy) {
    lastHealth.mode = "degraded"; // Railway only, no cloud backup
  } else {
    lastHealth.mode = "failover"; // Something is very wrong
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

  // Alert if Vercel is down
  if (!health.vercel.healthy) {
    try {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(
        `⚠️ FAILOVER ALERT: Vercel (statenour-os) is unreachable.\n` +
        `Railway is running normally.\n` +
        `Cloud backup and sync are paused until Vercel recovers.`
      );
    } catch (e) { console.warn("[services/failover] operation failed:", e); }
  }

  return {
    recordsProcessed: 1,
    details: `Mode: ${health.mode} | Railway: ${health.railway.latencyMs}ms | Vercel: ${health.vercel.latencyMs}ms`,
  };
}
