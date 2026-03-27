/**
 * NOUR OS Event Bridge
 *
 * Dispatches business events from nickstire to NOUR OS Unified's event bus.
 * Events are written to NOUR OS's events.jsonl file so they flow through
 * the existing cloud-sync pipeline to statenour-os.vercel.app.
 *
 * Also fires HTTP webhooks to the Vercel cloud endpoint for real-time sync.
 *
 * Event Types:
 *   nickstire:booking    — new booking created
 *   nickstire:booking:complete — booking marked completed
 *   nickstire:lead       — new lead captured
 *   nickstire:tire_order — tire order placed
 *   nickstire:invoice    — invoice auto-created
 *   nickstire:callback   — callback requested
 *   nickstire:review     — review received
 *   nickstire:revenue    — revenue milestone
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { createLogger } from "./lib/logger";

const log = createLogger("nour-os-bridge");

// ─── Configuration ───────────────────────────────────
const NOUR_OS_EVENTS_PATH = process.env.NOUR_OS_EVENTS_PATH
  || "C:/Users/nourd/Documents/nour-os-unified/data/logs/events.jsonl";
const STATENOUR_URL = process.env.STATENOUR_SYNC_URL || "https://statenour-os.vercel.app";
const SYNC_KEY = process.env.STATENOUR_SYNC_KEY || "";

// ─── Event Types ─────────────────────────────────────
export type NourOsEventType =
  | "nickstire:booking"
  | "nickstire:booking:complete"
  | "nickstire:lead"
  | "nickstire:tire_order"
  | "nickstire:invoice"
  | "nickstire:callback"
  | "nickstire:review"
  | "nickstire:revenue";

export interface NourOsEvent {
  type: NourOsEventType;
  timestamp: string;
  source: "nickstire";
  data: Record<string, unknown>;
}

// ─── In-memory event log (last 200 events for admin dashboard) ────
const EVENT_LOG: NourOsEvent[] = [];
const MAX_EVENT_LOG = 200;

// ─── Sync stats ──────────────────────────────────────
let totalEventsSent = 0;
let totalEventsLocal = 0;
let lastSyncTime: string | null = null;
let lastError: string | null = null;

/**
 * Dispatch a business event to NOUR OS.
 * Writes to local events.jsonl AND fires HTTP to cloud (non-blocking).
 */
export async function dispatchEvent(
  type: NourOsEventType,
  data: Record<string, unknown>
): Promise<void> {
  const event: NourOsEvent = {
    type,
    timestamp: new Date().toISOString(),
    source: "nickstire",
    data,
  };

  // Store in memory for admin dashboard
  EVENT_LOG.push(event);
  if (EVENT_LOG.length > MAX_EVENT_LOG) EVENT_LOG.shift();

  // 1. Write to local NOUR OS events.jsonl (fast, synchronous)
  writeToLocalEventBus(event);

  // 2. Push to cloud endpoint (async, non-blocking)
  pushToCloud(event).catch(err => {
    lastError = err instanceof Error ? err.message : String(err);
    log.warn("Cloud push failed (non-blocking)", { error: lastError });
  });
}

/**
 * Write event to NOUR OS Unified's local events.jsonl
 */
function writeToLocalEventBus(event: NourOsEvent): void {
  try {
    // Ensure directory exists
    const dir = NOUR_OS_EVENTS_PATH.replace(/[/\\][^/\\]+$/, "");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const line = JSON.stringify(event) + "\n";
    appendFileSync(NOUR_OS_EVENTS_PATH, line, "utf-8");
    totalEventsLocal++;
  } catch (err) {
    log.error("Failed to write to local event bus", {
      path: NOUR_OS_EVENTS_PATH,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Push event to statenour-os cloud endpoint
 */
async function pushToCloud(event: NourOsEvent): Promise<void> {
  try {
    const res = await fetch(`${STATENOUR_URL}/api/sync/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SYNC_KEY ? { Authorization: `Bearer ${SYNC_KEY}` } : {}),
      },
      body: JSON.stringify({ events: [event] }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "unknown")}`);
    }

    totalEventsSent++;
    lastSyncTime = new Date().toISOString();
  } catch (err) {
    throw err;
  }
}

// ─── Convenience Dispatchers ─────────────────────────

/** New booking created */
export function onBookingCreated(details: {
  id: number;
  name: string;
  phone: string;
  service: string;
  vehicle?: string | null;
  urgency: string;
  refCode: string;
}) {
  return dispatchEvent("nickstire:booking", {
    bookingId: details.id,
    customer: details.name,
    phone: details.phone,
    service: details.service,
    vehicle: details.vehicle || null,
    urgency: details.urgency,
    refCode: details.refCode,
  });
}

/** Booking completed — triggers invoice, review request, etc. */
export function onBookingCompleted(details: {
  id: number;
  name: string;
  service: string;
  invoiceNumber?: string;
  totalAmount?: number;
}) {
  return dispatchEvent("nickstire:booking:complete", {
    bookingId: details.id,
    customer: details.name,
    service: details.service,
    invoiceNumber: details.invoiceNumber || null,
    totalAmount: details.totalAmount || null,
  });
}

/** New lead captured */
export function onLeadCaptured(details: {
  id: number;
  name: string;
  phone: string;
  source: string;
  urgencyScore: number;
  interest?: string | null;
}) {
  return dispatchEvent("nickstire:lead", {
    leadId: details.id,
    customer: details.name,
    phone: details.phone,
    source: details.source,
    urgencyScore: details.urgencyScore,
    interest: details.interest || null,
  });
}

/** Tire order placed */
export function onTireOrderPlaced(details: {
  orderNumber: string;
  customerName: string;
  tireBrand: string;
  tireModel: string;
  quantity: number;
  totalAmount: number;
}) {
  return dispatchEvent("nickstire:tire_order", {
    orderNumber: details.orderNumber,
    customer: details.customerName,
    tire: `${details.quantity}x ${details.tireBrand} ${details.tireModel}`,
    totalAmount: details.totalAmount,
  });
}

/** Invoice auto-created */
export function onInvoiceCreated(details: {
  invoiceNumber: string;
  customerName: string;
  totalAmount: number;
  source: string;
}) {
  return dispatchEvent("nickstire:invoice", {
    invoiceNumber: details.invoiceNumber,
    customer: details.customerName,
    totalAmount: details.totalAmount,
    source: details.source,
  });
}

/** Callback requested */
export function onCallbackRequested(details: {
  name: string;
  phone: string;
  reason?: string | null;
}) {
  return dispatchEvent("nickstire:callback", {
    customer: details.name,
    phone: details.phone,
    reason: details.reason || null,
  });
}

/** Revenue milestone hit */
export function onRevenueMilestone(details: {
  milestone: string;
  totalRevenue: number;
  period: string;
}) {
  return dispatchEvent("nickstire:revenue", {
    milestone: details.milestone,
    totalRevenue: details.totalRevenue,
    period: details.period,
  });
}

// ─── Admin Dashboard API ─────────────────────────────

/** Get recent events for admin dashboard */
export function getRecentEvents(limit = 50): NourOsEvent[] {
  return EVENT_LOG.slice(-limit).reverse();
}

/** Get sync status for admin dashboard */
export function getSyncStatus(): {
  totalEventsLocal: number;
  totalEventsSent: number;
  lastSyncTime: string | null;
  lastError: string | null;
  eventsInMemory: number;
  localPath: string;
  cloudUrl: string;
} {
  return {
    totalEventsLocal,
    totalEventsSent,
    lastSyncTime,
    lastError,
    eventsInMemory: EVENT_LOG.length,
    localPath: NOUR_OS_EVENTS_PATH,
    cloudUrl: STATENOUR_URL,
  };
}
