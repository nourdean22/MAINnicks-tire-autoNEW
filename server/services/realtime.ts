/**
 * Real-time Event System — SSE-based admin feed + customer job tracking
 *
 * Uses Server-Sent Events (no extra dependencies).
 * Admin feed: new leads, bookings, revenue updates, alerts
 * Customer tracking: order status updates via /api/v1/sse/track/:orderId
 */

import type { Request, Response, Router } from "express";
import { createLogger } from "../lib/logger";

const log = createLogger("realtime");

// ─── Admin SSE connections ──────────────────────
const adminClients = new Set<Response>();

// ─── Customer order tracking connections ────────
const orderClients = new Map<string, Set<Response>>();

/**
 * Register SSE routes on an Express router
 */
export function registerSSERoutes(router: Router): void {
  // Admin real-time feed
  router.get("/api/v1/sse/admin-feed", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
    adminClients.add(res);
    log.info("Admin SSE client connected", { total: adminClients.size });

    req.on("close", () => {
      adminClients.delete(res);
      log.info("Admin SSE client disconnected", { total: adminClients.size });
    });
  });

  // Customer order tracking
  router.get("/api/v1/sse/track/:orderId", (req: Request, res: Response) => {
    const orderId = req.params.orderId;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.write(`event: connected\ndata: ${JSON.stringify({ orderId, timestamp: Date.now() })}\n\n`);

    if (!orderClients.has(orderId)) {
      orderClients.set(orderId, new Set());
    }
    orderClients.get(orderId)!.add(res);

    req.on("close", () => {
      orderClients.get(orderId)?.delete(res);
      if (orderClients.get(orderId)?.size === 0) {
        orderClients.delete(orderId);
      }
    });
  });
}

// ─── Periodic heartbeat + stale connection cleanup ──
// Send a heartbeat comment every 30s. Dead connections will throw on write,
// triggering cleanup. Also caps orderClients at 500 entries.
setInterval(() => {
  const heartbeat = `:heartbeat ${Date.now()}\n\n`;
  adminClients.forEach((client) => {
    try { client.write(heartbeat); } catch { adminClients.delete(client); }
  });
  for (const [orderId, clients] of orderClients) {
    clients.forEach((client: Response) => {
      try { client.write(heartbeat); } catch { clients.delete(client); }
    });
    if (clients.size === 0) orderClients.delete(orderId);
  }
  // Hard cap: if orderClients grows beyond 500 keys, drop oldest
  if (orderClients.size > 500) {
    const excess = orderClients.size - 500;
    const keys = Array.from(orderClients.keys());
    for (let i = 0; i < excess; i++) orderClients.delete(keys[i]);
  }
}, 30_000);

// ─── Emit functions (called by other services) ──

export function emitToAdmin(event: string, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  adminClients.forEach((client) => {
    try { client.write(message); } catch { adminClients.delete(client); }
  });
}

export function emitNewLead(lead: { name?: string; phone?: string; service?: string; source?: string; score?: number }): void {
  emitToAdmin("new-lead", { ...lead, timestamp: Date.now() });
}

export function emitNewBooking(booking: { name?: string; service?: string; date?: string }): void {
  emitToAdmin("new-booking", { ...booking, timestamp: Date.now() });
}

export function emitRevenueUpdate(data: { todayRevenue: number; jobCount: number }): void {
  emitToAdmin("revenue-update", { ...data, timestamp: Date.now() });
}

export function emitNewReview(review: { rating: number; text?: string; author?: string }): void {
  emitToAdmin("new-review", { ...review, timestamp: Date.now() });
}

export function emitAlert(alert: { type: string; message: string; severity: "info" | "warning" | "urgent" }): void {
  emitToAdmin("alert", { ...alert, timestamp: Date.now() });
}

export function emitOrderStatusUpdate(orderId: string, status: string, details?: Record<string, unknown>): void {
  // Emit to admin dashboard
  emitToAdmin("order-update", { orderId, status, ...details, timestamp: Date.now() });

  // Emit to customer tracking specific order
  const clients = orderClients.get(orderId);
  if (clients && clients.size > 0) {
    const message = `event: status-update\ndata: ${JSON.stringify({ status, ...details, timestamp: Date.now() })}\n\n`;
    clients.forEach((client) => {
      try { client.write(message); } catch { clients.delete(client); }
    });
  }
}

/** Get connection stats for health check */
export function getRealtimeStats(): { adminConnections: number; trackedOrders: number } {
  return {
    adminConnections: adminClients.size,
    trackedOrders: orderClients.size,
  };
}
