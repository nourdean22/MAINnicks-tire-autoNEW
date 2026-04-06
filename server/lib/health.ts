/**
 * Health Check — /api/health, /api/ping, /api/ready, POST /api/health/recover
 * Container-friendly endpoints for monitoring and orchestration.
 * Enhanced with degraded state, self-healing integration, and manual recovery.
 */

import type { Request, Response } from "express";
import { createLogger } from "./logger";

const log = createLogger("health");
const startTime = Date.now();

// ─── AI fallback message for when AI is completely down ─────
const AI_DOWN_FALLBACK_MESSAGE =
  "Our AI assistant is temporarily unavailable. For immediate help, " +
  "please call us at (216) 862-0005 or book online at nickstire.org. " +
  "We're here to help Mon-Sat 8AM-6PM, Sun 9AM-4PM.";

export { AI_DOWN_FALLBACK_MESSAGE };

// ─── /api/ping — lightweight liveness probe ─────
export function pingHandler(_req: Request, res: Response): void {
  res.json({ pong: true, timestamp: Date.now() });
}

// ─── /api/ready — readiness probe ───────────────
export async function readyHandler(_req: Request, res: Response): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();

    if (!db) {
      res.status(503).json({ ready: false, reason: "Database not connected" });
      return;
    }

    res.json({ ready: true, timestamp: Date.now() });
  } catch (err) {
    log.error("Readiness check failed", { error: err instanceof Error ? err.message : String(err) });
    res.status(503).json({ ready: false, reason: "Database check failed" });
  }
}

// ─── /api/health — full health check ────────────
export async function healthHandler(_req: Request, res: Response): Promise<void> {
  const checks: Record<string, { status: string; responseTime?: number; [key: string]: unknown }> = {};
  let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

  // Database check
  try {
    const dbStart = Date.now();
    const { getDb } = await import("../db");
    const db = await getDb();
    if (db) {
      // Simple query to verify connection
      await db.execute(await import("drizzle-orm").then(m => m.sql`SELECT 1`));
      checks.database = { status: "up", responseTime: Date.now() - dbStart };
    } else {
      checks.database = { status: "down" };
      overallStatus = "unhealthy";
    }
  } catch (err) {
    checks.database = { status: "down", error: err instanceof Error ? err.message : "connection failed" };
    // DB down = degraded (not immediately unhealthy — self-healing may recover)
    overallStatus = "degraded";
    log.error("Health check: database down", { error: err instanceof Error ? err.message : String(err) });
  }

  // Email check (configured?)
  checks.email = {
    status: process.env.RESEND_API_KEY ? "configured" : "not_configured",
  };

  // Twilio check (configured?)
  checks.twilio = {
    status: process.env.TWILIO_ACCOUNT_SID ? "configured" : "not_configured",
  };

  // Meta Pixel check
  checks.metaPixel = {
    status: process.env.META_PIXEL_ID ? "configured" : "using_default",
  };

  // AI Gateway check
  try {
    const { getGatewayHealth } = await import("./ai-gateway");
    const aiHealth = getGatewayHealth();
    const failureRate = aiHealth.stats.last5min.total > 0
      ? Math.round((aiHealth.stats.last5min.fallbacks / aiHealth.stats.last5min.total) * 100) + "%"
      : "n/a";

    checks.aiGateway = {
      status: aiHealth.circuitBreaker.open ? "degraded" : "up",
      ollamaHealthy: aiHealth.ollamaHealthy,
      circuitBreakerOpen: aiHealth.circuitBreaker.open,
      recentRequests: aiHealth.stats.last5min.total,
      recentFailures: aiHealth.stats.last5min.failures,
      fallbackRate: failureRate,
    };

    // AI gateway issues = degraded, not unhealthy (fallbacks exist)
    if (aiHealth.circuitBreaker.open && overallStatus === "healthy") {
      overallStatus = "degraded";
    }
  } catch (err) {
    checks.aiGateway = { status: "not_loaded" };
    log.warn("Health check: AI gateway not loaded", { error: err instanceof Error ? err.message : String(err) });
  }

  // Self-healing integration
  let selfHealingState: Record<string, unknown> = {};
  try {
    const { getSystemHealth } = await import("./self-healing");
    const sh = getSystemHealth();
    selfHealingState = {
      state: sh.state,
      healthScore: sh.healthScore,
      lastCheck: sh.lastCheck,
      checkCount: sh.checkCount,
      components: sh.components,
      eventLoopLagMs: sh.eventLoopLagMs,
      trends: sh.trends,
      requestRate: sh.requestRate,
      watchdog: sh.watchdog,
    };

    // Use self-healing state to inform overall status
    if (sh.state === "critical" && overallStatus !== "unhealthy") {
      overallStatus = "unhealthy";
    } else if (sh.state === "degraded" && overallStatus === "healthy") {
      overallStatus = "degraded";
    }
  } catch (err) {
    selfHealingState = { state: "not_started" };
    log.warn("Health check: self-healing not loaded", { error: err instanceof Error ? err.message : String(err) });
  }

  // Memory usage — compare against max-old-space-size ceiling, not V8's current allocation
  const mem = process.memoryUsage();
  const memUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const memTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  // Parse --max-old-space-size from NODE_OPTIONS (defaults to 512MB if not set)
  const maxMatch = (process.env.NODE_OPTIONS || "").match(/--max-old-space-size=(\d+)/);
  const heapCeilingMB = maxMatch ? parseInt(maxMatch[1], 10) : 512;
  const memPercent = heapCeilingMB > 0 ? Math.round((memUsedMB / heapCeilingMB) * 100) : 0;

  // Memory pressure = degraded (only when truly approaching the ceiling)
  if (memPercent >= 90 && overallStatus === "healthy") {
    overallStatus = "degraded";
  }

  // Degrade if critical services not configured
  if (checks.email.status === "not_configured" || checks.twilio.status === "not_configured") {
    if (overallStatus === "healthy") overallStatus = "degraded";
  }

  const statusCode = overallStatus === "unhealthy" ? 503 : 200;

  res.status(statusCode).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.round((Date.now() - startTime) / 1000),
    version: process.env.npm_package_version || "1.0.0",
    checks,
    selfHealing: selfHealingState,
    memory: {
      usedMB: memUsedMB,
      totalMB: memTotalMB,
      rssMB: Math.round(mem.rss / 1024 / 1024),
      percent: memPercent,
    },
    gracefulDegradation: {
      aiDownFallback: checks.aiGateway?.status !== "up",
      dbReadOnlyMode: checks.database?.status !== "up",
    },
  });
}

// ─── POST /api/health/recover — admin-triggered recovery ────
export async function recoverHandler(req: Request, res: Response): Promise<void> {
  // Auth check: require ADMIN_API_KEY
  const auth = req.headers.authorization;
  const expected = process.env.ADMIN_API_KEY;

  if (!expected || typeof auth !== "string") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const expectedFull = `Bearer ${expected}`;
  try {
    const crypto = await import("crypto");
    if (auth.length !== expectedFull.length || !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expectedFull))) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  } catch {
    res.status(401).json({ error: "Auth verification failed" });
    return;
  }

  log.info("Manual recovery triggered via admin endpoint");

  try {
    const { triggerManualRecovery } = await import("./self-healing");
    const result = await triggerManualRecovery();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      previousState: result.previousState,
      newState: result.newState,
      results: result.results,
    });
  } catch (err) {
    log.error("Manual recovery failed", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
