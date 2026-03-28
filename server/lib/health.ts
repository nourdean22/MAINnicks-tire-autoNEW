/**
 * Health Check — /api/health, /api/ping, /api/ready
 * Container-friendly endpoints for monitoring and orchestration.
 */

import type { Request, Response } from "express";
import { createLogger } from "./logger";

const log = createLogger("health");
const startTime = Date.now();

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
  const checks: Record<string, { status: string; responseTime?: number }> = {};
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
  } catch {
    checks.database = { status: "down" };
    overallStatus = "degraded";
  }

  // Email check (configured?) — try both RESEND_API_KEY and RESEND_KEY fallback
  const resendKey = process.env.RESEND_API_KEY || process.env.RESEND_KEY;
  checks.email = {
    status: resendKey ? "configured" : "not_configured",
    keyPrefix: resendKey ? resendKey.slice(0, 5) + "..." : "missing",
    envKeys: Object.keys(process.env).filter(k => k.includes("RESEND") || k.includes("EMAIL")).join(",") || "none",
  };

  // Twilio check (configured?)
  checks.twilio = {
    status: process.env.TWILIO_ACCOUNT_SID ? "configured" : "not_configured",
  };

  // Meta Pixel check
  checks.metaPixel = {
    status: process.env.META_PIXEL_ID || "1436350367898578" ? "configured" : "missing",
  };

  // Memory usage
  const mem = process.memoryUsage();
  const memUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const memTotalMB = Math.round(mem.heapTotal / 1024 / 1024);

  // Degrade if any non-critical check is down
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
    memory: {
      usedMB: memUsedMB,
      totalMB: memTotalMB,
      percent: Math.round((memUsedMB / memTotalMB) * 100),
    },
  });
}
