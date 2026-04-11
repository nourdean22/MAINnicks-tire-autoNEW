/**
 * Statenour Bridge — Real-time metrics relay for NOUR OS
 *
 * Establishes an SSE connection to /api/admin/events and listens for
 * live business events (bookings, completions, revenue, SMS, leads).
 * Transforms each event into a unified metrics snapshot that NOUR OS
 * can poll at /api/bridge/realtime-metrics every 30 seconds instead
 * of waiting for the daily cron sync.
 *
 * Architecture:
 *   nickstire event bus → realtimePush (SSE) → statenourBridge (SSE client)
 *   → in-memory metrics cache (30s TTL) → /api/bridge/realtime-metrics
 *
 * NOUR OS polls /api/bridge/realtime-metrics with X-Bridge-Key header.
 * The endpoint returns current cached metrics plus a freshness indicator
 * so the CEO dashboard can show how stale the data is.
 */

import { createLogger } from "../lib/logger";
import { timingSafeEqual } from "crypto";

const log = createLogger("statenour-bridge");

// ─── Metrics State ────────────────────────────────────

export interface RealtimeMetrics {
  timestamp: string;
  /** Human-readable age of the data, e.g. "5s", "2m", "stale" */
  freshness: string;
  revenue: {
    today: number;
    target: number;
    pace: "ahead" | "behind" | "on_track";
  };
  bookings: {
    active: number;
    completed_today: number;
    pending: number;
  };
  leads: {
    new: number;
    contacted: number;
    quality_score: number;
  };
  chat: {
    sessions_today: number;
    converted: number;
  };
  sms: {
    sent_today: number;
    failed: number;
  };
}

// Default zero-state — returned before the first real data arrives
const DEFAULT_METRICS: Omit<RealtimeMetrics, "timestamp" | "freshness"> = {
  revenue: { today: 0, target: 0, pace: "behind" },
  bookings: { active: 0, completed_today: 0, pending: 0 },
  leads: { new: 0, contacted: 0, quality_score: 0 },
  chat: { sessions_today: 0, converted: 0 },
  sms: { sent_today: 0, failed: 0 },
};

// Mutable in-memory cache — updated by SSE events and periodic refresh
let cachedMetrics: Omit<RealtimeMetrics, "timestamp" | "freshness"> = { ...DEFAULT_METRICS };
let lastUpdatedAt: number = 0; // epoch ms — 0 means never updated

// ─── TTL & Refresh Config ─────────────────────────────

const REFRESH_INTERVAL_MS = 30_000; // Pull fresh DB snapshot every 30s
const SSE_RECONNECT_DELAY_MS = 5_000; // Wait 5s before reconnecting SSE

// ─── Freshness Helper ─────────────────────────────────

function computeFreshness(lastUpdated: number): string {
  if (lastUpdated === 0) return "stale";
  const ageMs = Date.now() - lastUpdated;
  if (ageMs < 1_000) return "0s";
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1_000)}s`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m`;
  return "stale";
}

// ─── Metrics Snapshot from DB ─────────────────────────
// Pulls a full snapshot from the database. Called on startup and every
// REFRESH_INTERVAL_MS to keep the cache warm even when SSE is quiet.

async function fetchMetricsSnapshot(): Promise<void> {
  try {
    const { BUSINESS } = await import("@shared/business");
    const dailyTarget = Math.round(BUSINESS.revenueTarget.monthly / 26);

    // Revenue — today's paid invoices
    let todayRevenue = 0;
    let completedToday = 0;
    try {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (db) {
        const [row] = await db.execute(sql`
          SELECT
            COALESCE(SUM(totalAmount), 0) AS rev,
            COUNT(*) AS cnt
          FROM invoices
          WHERE DATE(invoiceDate) = CURDATE()
            AND paymentStatus = 'paid'
        `);
        const r = (row as Record<string, unknown>[])?.[0] ?? {};
        todayRevenue = Math.round(Number(r.rev ?? 0) / 100);
        completedToday = Number(r.cnt ?? 0);
      }
    } catch (e) {
      console.warn("[statenourBridge] revenue DB query failed:", e);
    }

    // Bookings — active (new/confirmed), pending (awaiting confirmation)
    let activeBookings = 0;
    let pendingBookings = 0;
    try {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (db) {
        const [rows] = await db.execute(sql`
          SELECT
            SUM(CASE WHEN status IN ('confirmed') THEN 1 ELSE 0 END) AS active_cnt,
            SUM(CASE WHEN status IN ('new', 'pending') THEN 1 ELSE 0 END) AS pending_cnt
          FROM bookings
          WHERE DATE(createdAt) = CURDATE()
             OR status IN ('new', 'pending', 'confirmed')
        `);
        const r = (rows as Record<string, unknown>[])?.[0] ?? {};
        activeBookings = Number(r.active_cnt ?? 0);
        pendingBookings = Number(r.pending_cnt ?? 0);
      }
    } catch (e) {
      console.warn("[statenourBridge] bookings DB query failed:", e);
    }

    // Leads — new and contacted today, average urgency score
    let newLeads = 0;
    let contactedLeads = 0;
    let avgUrgency = 0;
    try {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (db) {
        const [rows] = await db.execute(sql`
          SELECT
            SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_cnt,
            SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) AS contacted_cnt,
            ROUND(AVG(urgencyScore), 1) AS avg_urgency
          FROM leads
          WHERE DATE(createdAt) = CURDATE()
        `);
        const r = (rows as Record<string, unknown>[])?.[0] ?? {};
        newLeads = Number(r.new_cnt ?? 0);
        contactedLeads = Number(r.contacted_cnt ?? 0);
        avgUrgency = Number(r.avg_urgency ?? 0);
      }
    } catch (e) {
      console.warn("[statenourBridge] leads DB query failed:", e);
    }

    // Chat — sessions and conversions today
    let chatSessions = 0;
    let chatConverted = 0;
    try {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (db) {
        const [rows] = await db.execute(sql`
          SELECT
            COUNT(*) AS sessions,
            SUM(CASE WHEN converted = 1 THEN 1 ELSE 0 END) AS converted_cnt
          FROM chatSessions
          WHERE DATE(createdAt) = CURDATE()
        `);
        const r = (rows as Record<string, unknown>[])?.[0] ?? {};
        chatSessions = Number(r.sessions ?? 0);
        chatConverted = Number(r.converted_cnt ?? 0);
      }
    } catch (e) {
      console.warn("[statenourBridge] chat DB query failed:", e);
    }

    // SMS — sent and failed today
    let smsSent = 0;
    let smsFailed = 0;
    try {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (db) {
        const [rows] = await db.execute(sql`
          SELECT
            SUM(CASE WHEN direction = 'outbound' AND status != 'failed' THEN 1 ELSE 0 END) AS sent_cnt,
            SUM(CASE WHEN direction = 'outbound' AND status = 'failed' THEN 1 ELSE 0 END) AS failed_cnt
          FROM communicationLog
          WHERE type = 'sms'
            AND DATE(createdAt) = CURDATE()
        `);
        const r = (rows as Record<string, unknown>[])?.[0] ?? {};
        smsSent = Number(r.sent_cnt ?? 0);
        smsFailed = Number(r.failed_cnt ?? 0);
      }
    } catch (e) {
      console.warn("[statenourBridge] SMS DB query failed:", e);
    }

    // Determine revenue pace
    let pace: "ahead" | "behind" | "on_track" = "behind";
    if (todayRevenue >= dailyTarget * 1.1) pace = "ahead";
    else if (todayRevenue >= dailyTarget * 0.9) pace = "on_track";

    cachedMetrics = {
      revenue: {
        today: todayRevenue,
        target: dailyTarget,
        pace,
      },
      bookings: {
        active: activeBookings,
        completed_today: completedToday,
        pending: pendingBookings,
      },
      leads: {
        new: newLeads,
        contacted: contactedLeads,
        quality_score: avgUrgency,
      },
      chat: {
        sessions_today: chatSessions,
        converted: chatConverted,
      },
      sms: {
        sent_today: smsSent,
        failed: smsFailed,
      },
    };

    lastUpdatedAt = Date.now();
    log.info("Metrics snapshot refreshed", {
      revenue: todayRevenue,
      bookings: activeBookings + completedToday + pendingBookings,
      leads: newLeads + contactedLeads,
    });
  } catch (err) {
    log.warn("fetchMetricsSnapshot failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── SSE Event Handlers ───────────────────────────────
// Each handler applies a targeted delta to the cached metrics so the
// cache stays current between full DB refreshes.

function handleSseEvent(eventType: string, data: Record<string, unknown>): void {
  switch (eventType) {
    case "booking_created": {
      cachedMetrics = {
        ...cachedMetrics,
        bookings: {
          ...cachedMetrics.bookings,
          pending: cachedMetrics.bookings.pending + 1,
        },
      };
      break;
    }

    case "booking_completed": {
      const amount = Number(data.totalAmount ?? 0) / 100;
      cachedMetrics = {
        ...cachedMetrics,
        revenue: {
          ...cachedMetrics.revenue,
          today: cachedMetrics.revenue.today + amount,
        },
        bookings: {
          ...cachedMetrics.bookings,
          active: Math.max(0, cachedMetrics.bookings.active - 1),
          completed_today: cachedMetrics.bookings.completed_today + 1,
        },
      };
      break;
    }

    case "invoice_paid": {
      // Revenue milestone — add to today's total
      const amount = Number(data.totalAmount ?? 0) / 100;
      const newToday = cachedMetrics.revenue.today + amount;
      let pace: "ahead" | "behind" | "on_track" = "behind";
      if (newToday >= cachedMetrics.revenue.target * 1.1) pace = "ahead";
      else if (newToday >= cachedMetrics.revenue.target * 0.9) pace = "on_track";
      cachedMetrics = {
        ...cachedMetrics,
        revenue: { ...cachedMetrics.revenue, today: newToday, pace },
      };
      break;
    }

    case "lead_captured": {
      const score = Number(data.urgencyScore ?? data.leadScore ?? 0);
      // Recalculate rolling average quality score
      const totalLeads = cachedMetrics.leads.new + cachedMetrics.leads.contacted + 1;
      const prevTotal = cachedMetrics.leads.new + cachedMetrics.leads.contacted;
      const newAvg = prevTotal > 0
        ? Math.round(((cachedMetrics.leads.quality_score * prevTotal) + score) / totalLeads * 10) / 10
        : score;
      cachedMetrics = {
        ...cachedMetrics,
        leads: {
          ...cachedMetrics.leads,
          new: cachedMetrics.leads.new + 1,
          quality_score: newAvg,
        },
      };
      break;
    }

    case "stage_changed": {
      // Lead moved to contacted
      if (data.stage === "contacted" || data.toStatus === "contacted") {
        cachedMetrics = {
          ...cachedMetrics,
          leads: {
            ...cachedMetrics.leads,
            new: Math.max(0, cachedMetrics.leads.new - 1),
            contacted: cachedMetrics.leads.contacted + 1,
          },
        };
      }
      break;
    }

    case "campaign_sent": {
      // SMS campaign batch — data.count is the number sent
      const count = Number(data.count ?? data.sent ?? 1);
      const failed = Number(data.failed ?? 0);
      cachedMetrics = {
        ...cachedMetrics,
        sms: {
          sent_today: cachedMetrics.sms.sent_today + count,
          failed: cachedMetrics.sms.failed + failed,
        },
      };
      break;
    }

    default:
      // Unknown event type — no delta applied; next DB refresh will catch it
      break;
  }

  lastUpdatedAt = Date.now();
}

// ─── SSE Client ───────────────────────────────────────
// Connects to the local /api/admin/events SSE stream and processes
// incoming events. Reconnects automatically on disconnect.

let sseActive = false;
let sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;

async function connectToSseStream(): Promise<void> {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    log.warn("ADMIN_API_KEY not set — SSE stream connection skipped");
    return;
  }

  // Determine the local server URL — always localhost since this runs in-process
  const port = process.env.PORT || "3000";
  const sseUrl = `http://localhost:${port}/api/admin/events`;

  try {
    log.info("Connecting to SSE stream", { url: sseUrl });

    const response = await fetch(sseUrl, {
      headers: {
        Authorization: `Bearer ${adminKey}`,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
      // No timeout — SSE is a long-lived connection
    });

    if (!response.ok) {
      throw new Error(`SSE connect failed: HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error("SSE response has no body");
    }

    sseActive = true;
    log.info("SSE stream connected");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Parse SSE stream line by line
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      let currentEventType = "";
      let currentData = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData = line.slice(6).trim();
        } else if (line === "" && currentData) {
          // Blank line = end of event block
          if (currentEventType && currentEventType !== "connected") {
            try {
              const parsed = JSON.parse(currentData) as Record<string, unknown>;
              handleSseEvent(currentEventType, parsed);
            } catch {
              // Malformed JSON — skip silently
            }
          }
          currentEventType = "";
          currentData = "";
        }
        // Lines starting with ":" are SSE comments (heartbeats) — ignore
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("SSE stream disconnected", { error: msg });
  } finally {
    sseActive = false;
    // Schedule reconnect
    if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
    sseReconnectTimer = setTimeout(() => {
      connectToSseStream().catch((e) =>
        console.warn("[statenourBridge] SSE reconnect failed:", e)
      );
    }, SSE_RECONNECT_DELAY_MS);
  }
}

// ─── Periodic DB Refresh ──────────────────────────────

let refreshTimer: ReturnType<typeof setInterval> | null = null;

function startPeriodicRefresh(): void {
  if (refreshTimer) return;
  // Immediate first fetch
  fetchMetricsSnapshot().catch((e) =>
    console.warn("[statenourBridge] initial snapshot failed:", e)
  );
  refreshTimer = setInterval(() => {
    fetchMetricsSnapshot().catch((e) =>
      console.warn("[statenourBridge] periodic snapshot failed:", e)
    );
  }, REFRESH_INTERVAL_MS);
  log.info("Periodic metrics refresh started (30s interval)");
}

function stopPeriodicRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (sseReconnectTimer) {
    clearTimeout(sseReconnectTimer);
    sseReconnectTimer = null;
  }
}

// ─── Public API ───────────────────────────────────────

/**
 * Start the bridge: connect to SSE stream and begin periodic DB refresh.
 * Called once from server startup.
 */
export function startStatenourBridge(): void {
  startPeriodicRefresh();
  // Delay SSE connection slightly to let the HTTP server finish binding
  setTimeout(() => {
    connectToSseStream().catch((e) =>
      console.warn("[statenourBridge] initial SSE connect failed:", e)
    );
  }, 3_000);
  log.info("Statenour bridge started");
}

/**
 * Stop the bridge (called on graceful shutdown).
 */
export function stopStatenourBridge(): void {
  stopPeriodicRefresh();
  sseActive = false;
  log.info("Statenour bridge stopped");
}

/**
 * Returns the current cached metrics with freshness metadata.
 * Safe to call at any time — returns stale data if cache is cold.
 */
export function getRealtimeMetrics(): RealtimeMetrics {
  return {
    timestamp: new Date().toISOString(),
    freshness: computeFreshness(lastUpdatedAt),
    ...cachedMetrics,
  };
}

/**
 * Express middleware: authenticate via BRIDGE_API_KEY header.
 * Accepts the key in either X-Bridge-Key (existing bridge convention)
 * or BRIDGE-API-KEY header for NOUR OS compatibility.
 */
export function requireBridgeApiKey(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction
): void {
  const expectedKey = process.env.BRIDGE_API_KEY;
  if (!expectedKey) {
    res.status(503).json({ error: "Bridge not configured" });
    return;
  }

  // Accept key from either header name
  const provided =
    (req.headers["x-bridge-key"] as string | undefined) ??
    (req.headers["bridge-api-key"] as string | undefined);

  if (
    typeof provided !== "string" ||
    provided.length !== expectedKey.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expectedKey))
  ) {
    res.status(401).json({ error: "Invalid bridge key" });
    return;
  }

  next();
}
