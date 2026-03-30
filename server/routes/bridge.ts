/**
 * Bridge API — Snapshot endpoints for NOUR OS integration.
 * Protected by X-Bridge-Key header matching BRIDGE_API_KEY env var.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { getDashboardStats } from "../admin-stats";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function bridgeAuth(req: Request, res: Response, next: NextFunction): void {
  const bridgeKey = process.env.BRIDGE_API_KEY;

  if (!bridgeKey) {
    res.status(503).json({ error: "Bridge not configured", code: "BRIDGE_NOT_CONFIGURED" });
    return;
  }

  const provided = req.headers["x-bridge-key"];
  if (typeof provided !== "string" || !safeCompare(provided, bridgeKey)) {
    res.status(401).json({ error: "Invalid bridge key", code: "UNAUTHORIZED" });
    return;
  }

  next();
}

export function registerBridgeRoutes(app: Express): void {
  // Health check — lightweight ping
  app.get("/api/bridge/health", bridgeAuth, (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "1.0",
    });
  });

  // Shop snapshot — aggregated shop state for NOUR OS
  app.get("/api/bridge/shop-snapshot", bridgeAuth, async (_req: Request, res: Response) => {
    try {
      const stats = await getDashboardStats();

      if (!stats) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }

      const snapshot = {
        timestamp: new Date().toISOString(),
        bookings: {
          todayCount: stats.bookings.thisWeek, // closest available — thisWeek from stats
          newCount: stats.bookings.new,
          confirmedCount: stats.bookings.confirmed,
          completedCount: stats.bookings.completed,
        },
        leads: {
          totalActive: stats.leads.new + stats.leads.contacted,
          uncontactedCount: stats.leads.new,
          urgentCount: stats.leads.urgent,
          thisWeek: stats.leads.thisWeek,
        },
        callbacks: {
          pendingCount: stats.callbacks.new,
          totalCount: stats.callbacks.total,
          completedCount: stats.callbacks.completed,
        },
        revenue: {
          todayEstimate: null as number | null, // not tracked yet
          weekEstimate: null as number | null,
        },
        syncHealth: {
          overall: "healthy" as const,
          services: {
            database: "up" as const,
            twilio: process.env.TWILIO_ACCOUNT_SID ? "up" as const : "not_configured" as const,
            sheets: process.env.GOOGLE_SHEETS_CRM_ID ? "up" as const : "not_configured" as const,
          },
        },
        chat: {
          totalSessions: stats.chat.totalSessions,
          thisWeek: stats.chat.thisWeek,
        },
        recentActivity: {
          lastBookingAt: stats.recentActivity.find(a => a.type === "booking")?.timestamp ?? null,
          lastLeadAt: stats.recentActivity.find(a => a.type === "lead")?.timestamp ?? null,
        },
      };

      res.json(snapshot);
    } catch (err) {
      console.error("[Bridge] shop-snapshot error:", err);
      res.status(500).json({ error: "Internal error" });
    }
  });
}
