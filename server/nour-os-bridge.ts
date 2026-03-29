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
  | "nickstire:revenue"
  | "nickstire:vendor_health"
  | "nickstire:vendor_degraded"
  | "nickstire:vendor_recovered"
  | "nickstire:work_order"
  | "nickstire:work_order:status"
  | "nickstire:shop_floor";

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

// ─── Vendor Health Alerts ─────────────────────────────

/** Track which vendors were previously down so we can detect recovery */
const previousVendorStates = new Map<string, "healthy" | "degraded" | "down" | "not_configured">();

/**
 * Dispatch vendor health snapshot to NOUR OS.
 * Detects state transitions (healthy→down, down→healthy) and dispatches alerts.
 */
export async function dispatchVendorHealthSnapshot(results: Array<{
  vendor: string;
  status: "healthy" | "degraded" | "down" | "not_configured";
  checks: Array<{ name: string; passed: boolean; latencyMs: number; error?: string }>;
}>): Promise<void> {
  // Dispatch overall health snapshot
  const downVendors = results.filter(r => r.status === "down" || r.status === "degraded");
  const healthyCount = results.filter(r => r.status === "healthy").length;

  await dispatchEvent("nickstire:vendor_health", {
    totalVendors: results.length,
    healthyCount,
    degradedCount: results.filter(r => r.status === "degraded").length,
    downCount: results.filter(r => r.status === "down").length,
    vendors: results.map(r => ({ vendor: r.vendor, status: r.status })),
  });

  // Check for state transitions
  for (const result of results) {
    const prev = previousVendorStates.get(result.vendor);

    if (prev && (prev === "healthy") && (result.status === "down" || result.status === "degraded")) {
      // Vendor went down — alert
      await dispatchEvent("nickstire:vendor_degraded", {
        vendor: result.vendor,
        previousStatus: prev,
        currentStatus: result.status,
        errors: result.checks.filter(c => !c.passed).map(c => c.error).filter(Boolean),
      });
      console.error(`[ALERT] Vendor ${result.vendor} degraded: ${prev} → ${result.status}`);
    }

    if (prev && (prev === "down" || prev === "degraded") && result.status === "healthy") {
      // Vendor recovered — notify
      await dispatchEvent("nickstire:vendor_recovered", {
        vendor: result.vendor,
        previousStatus: prev,
        currentStatus: result.status,
      });
      console.log(`[RECOVERY] Vendor ${result.vendor} recovered: ${prev} → ${result.status}`);
    }

    previousVendorStates.set(result.vendor, result.status);
  }
}

// ─── Shop Floor Snapshot ────────────────────────────────

/**
 * Dispatch shop floor snapshot to NOUR OS.
 * Contains work order stats for the command deck card and daily brief.
 */
export async function dispatchShopFloorSnapshot(): Promise<void> {
  try {
    const { getWorkOrderStats } = await import("./services/workOrderService");
    const stats = await getWorkOrderStats();

    // Enrich with dispatch + QC + risk data
    let dispatchData: Record<string, unknown> = {};
    try {
      const { getDispatchLoad } = await import("./services/dispatch");
      const load = await getDispatchLoad();
      const clockedIn = load.techs.filter(t => t.clockedIn).length;
      const freeBays = load.bays.filter(b => !b.occupied).length;
      dispatchData = { techsClockedIn: clockedIn, freeBays: freeBays, totalBays: load.bays.length };
    } catch (_) {}

    let qcData: Record<string, unknown> = {};
    try {
      const { getQcStats } = await import("./services/qcService");
      const qc = await getQcStats();
      qcData = { qcPassRate: qc.passRate, qcPending: qc.qcPending, comebacks30d: qc.comebacks30d };
    } catch (_) {}

    let riskData: Record<string, unknown> = {};
    try {
      const { getPromiseRiskSummary } = await import("./services/promiseRisk");
      const risk = await getPromiseRiskSummary();
      riskData = { atRisk: risk.atRisk, likelyLate: risk.likelyLate, overdue: risk.overdue };
    } catch (_) {}

    let declinedData: Record<string, unknown> = {};
    try {
      const { getDeclinedWorkStats } = await import("./services/declinedWorkRecovery");
      const declined = await getDeclinedWorkStats();
      declinedData = { declinedValue30d: declined.totalDeclinedValue, declinedItems30d: declined.totalDeclinedItems };
    } catch (_) {}

    await dispatchEvent("nickstire:shop_floor", {
      active: stats.active,
      inProgress: stats.inProgress,
      blocked: stats.blocked,
      overdue: stats.overdue,
      readyForPickup: stats.readyForPickup,
      totalValueInProgress: stats.totalValueInProgress,
      byStatus: stats.byStatus,
      ...dispatchData,
      ...qcData,
      ...riskData,
      ...declinedData,
    });
  } catch (err) {
    log.warn("Shop floor snapshot dispatch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Dispatch work order status change event */
export function onWorkOrderStatusChange(details: {
  workOrderId: string;
  orderNumber: string;
  fromStatus: string;
  toStatus: string;
  service?: string;
}) {
  return dispatchEvent("nickstire:work_order:status", {
    workOrderId: details.workOrderId,
    orderNumber: details.orderNumber,
    fromStatus: details.fromStatus,
    toStatus: details.toStatus,
    service: details.service || null,
  });
}
