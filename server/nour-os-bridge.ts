/**
 * NOUR OS Event Bridge
 *
 * UPGRADED: Event queuing with retry, deduplication, priority routing,
 * health checks, event analytics, circuit breaker protection.
 *
 * Dispatches business events from nickstire to NOUR OS Unified's event bus.
 * Events are written to NOUR OS's events.jsonl file so they flow through
 * the existing cloud-sync pipeline to statenour-os.vercel.app.
 *
 * Also fires HTTP webhooks to the Vercel cloud endpoint for real-time sync.
 *
 * Event Types:
 *   nickstire:booking         — new booking created
 *   nickstire:booking:complete — booking marked completed
 *   nickstire:lead            — new lead captured
 *   nickstire:tire_order      — tire order placed
 *   nickstire:invoice         — invoice created (manual or auto)
 *   nickstire:callback        — callback requested
 *   nickstire:review          — Google review detected
 *   nickstire:revenue         — revenue milestone
 *   nickstire:stage-change    — booking stage transition
 *   nickstire:campaign-result — SMS campaign batch completed
 *   nickstire:emergency       — after-hours emergency request
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { createLogger } from "./lib/logger";
import { getOrCreateBreaker } from "./lib/circuit-breaker";

const log = createLogger("nour-os-bridge");

// ─── Configuration ───────────────────────────────────
const NOUR_OS_EVENTS_PATH = process.env.NOUR_OS_EVENTS_PATH
  || "C:/Users/nourd/Documents/nour-os-unified/data/logs/events.jsonl";
const STATENOUR_URL = process.env.STATENOUR_SYNC_URL || "https://statenour-os.vercel.app";
const SYNC_KEY = process.env.STATENOUR_SYNC_KEY || "";

// ─── Circuit Breaker for cloud push ─────────────────
const cloudCB = getOrCreateBreaker("nour-os-cloud", {
  failureThreshold: 3,
  cooldownMs: 60_000,
  timeoutMs: 15_000,
});

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
  | "nickstire:shop_floor"
  | "nickstire:stage-change"
  | "nickstire:campaign-result"
  | "nickstire:emergency";

export interface NourOsEvent {
  type: NourOsEventType;
  timestamp: string;
  source: "nickstire";
  data: Record<string, unknown>;
  /** Unique event ID for deduplication */
  eventId?: string;
}

// ─── Priority Config ────────────────────────────────
// Critical events skip the queue and send immediately
const CRITICAL_EVENTS: Set<NourOsEventType> = new Set([
  "nickstire:booking",
  "nickstire:lead",
  "nickstire:emergency",
  "nickstire:callback",
]);

// ─── Event Deduplication ────────────────────────────
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const recentEventHashes = new Map<string, number>(); // hash → timestamp

function computeEventHash(type: NourOsEventType, data: Record<string, unknown>): string {
  // Hash based on event type + key data fields
  const keyData = JSON.stringify({ type, ...pickKeyFields(type, data) });
  // Simple hash: sum of char codes (fast, sufficient for dedup)
  let hash = 0;
  for (let i = 0; i < keyData.length; i++) {
    hash = ((hash << 5) - hash + keyData.charCodeAt(i)) | 0;
  }
  return `${type}:${hash}`;
}

function pickKeyFields(type: NourOsEventType, data: Record<string, unknown>): Record<string, unknown> {
  // Pick the fields that make an event unique
  switch (type) {
    case "nickstire:booking":
      return { bookingId: data.bookingId };
    case "nickstire:lead":
      return { leadId: data.leadId };
    case "nickstire:invoice":
      return { invoiceNumber: data.invoiceNumber };
    case "nickstire:review":
      return { customerName: data.customerName, rating: data.rating };
    case "nickstire:stage-change":
      return { bookingId: data.bookingId, stage: data.stage };
    case "nickstire:work_order:status":
      return { workOrderId: data.workOrderId, toStatus: data.toStatus };
    default:
      return data;
  }
}

function isDuplicate(type: NourOsEventType, data: Record<string, unknown>): boolean {
  const hash = computeEventHash(type, data);
  const now = Date.now();

  // Clean old entries
  if (recentEventHashes.size > 100) {
    for (const [key, ts] of recentEventHashes) {
      if (now - ts > DEDUP_WINDOW_MS) recentEventHashes.delete(key);
    }
  }

  const existing = recentEventHashes.get(hash);
  if (existing && now - existing < DEDUP_WINDOW_MS) {
    return true; // Duplicate
  }

  recentEventHashes.set(hash, now);
  return false;
}

// ─── Event Analytics ────────────────────────────────
interface EventAnalytics {
  totalDispatched: number;
  totalLocalWrites: number;
  totalCloudPushes: number;
  totalCloudFailures: number;
  totalDeduplicated: number;
  totalRetried: number;
  avgCloudLatencyMs: number;
  cloudLatencySamples: number[];
  lastEventAt: string | null;
  lastCloudSuccessAt: string | null;
  lastCloudErrorAt: string | null;
  lastCloudError: string | null;
  eventsByType: Record<string, number>;
}

const analytics: EventAnalytics = {
  totalDispatched: 0,
  totalLocalWrites: 0,
  totalCloudPushes: 0,
  totalCloudFailures: 0,
  totalDeduplicated: 0,
  totalRetried: 0,
  avgCloudLatencyMs: 0,
  cloudLatencySamples: [],
  lastEventAt: null,
  lastCloudSuccessAt: null,
  lastCloudErrorAt: null,
  lastCloudError: null,
  eventsByType: {},
};

function recordCloudLatency(ms: number): void {
  analytics.cloudLatencySamples.push(ms);
  // Keep last 100 samples
  if (analytics.cloudLatencySamples.length > 20) {
    analytics.cloudLatencySamples.shift();
  }
  analytics.avgCloudLatencyMs = Math.round(
    analytics.cloudLatencySamples.reduce((a, b) => a + b, 0) /
    analytics.cloudLatencySamples.length
  );
}

export function getEventAnalytics(): Omit<EventAnalytics, "cloudLatencySamples"> {
  const { cloudLatencySamples, ...rest } = analytics;
  return rest;
}

// ─── Retry Queue ────────────────────────────────────
interface QueuedEvent {
  event: NourOsEvent;
  attempts: number;
  nextRetryAt: number;
}

const retryQueue: QueuedEvent[] = [];
const MAX_RETRY_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 5_000; // 5s, 10s, 20s, 40s, 80s

function scheduleRetry(event: NourOsEvent, attempts: number): void {
  if (attempts >= MAX_RETRY_ATTEMPTS) {
    log.error("Event exceeded max retries, dropping", {
      type: event.type,
      eventId: event.eventId,
      attempts,
    });
    return;
  }

  const backoff = BASE_BACKOFF_MS * Math.pow(2, attempts);
  retryQueue.push({
    event,
    attempts,
    nextRetryAt: Date.now() + backoff,
  });
  analytics.totalRetried++;
  log.info("Event queued for retry", {
    type: event.type,
    eventId: event.eventId,
    attempt: attempts + 1,
    retryInMs: backoff,
  });
}

// ─── Health Check ───────────────────────────────────
let cloudHealthy = true;
let lastHealthCheckAt: number = 0;
const HEALTH_CHECK_INTERVAL_MS = 60_000; // 1 minute

async function checkCloudHealth(): Promise<boolean> {
  const now = Date.now();
  if (now - lastHealthCheckAt < HEALTH_CHECK_INTERVAL_MS) {
    return cloudHealthy;
  }
  lastHealthCheckAt = now;

  try {
    const res = await fetch(`${STATENOUR_URL}/api/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    cloudHealthy = res.ok || res.status === 404; // 404 is ok, endpoint might not exist
    return cloudHealthy;
  } catch {
    cloudHealthy = false;
    return false;
  }
}

// ─── In-memory event log (last 200 events for admin dashboard) ────
const EVENT_LOG: NourOsEvent[] = [];
const MAX_EVENT_LOG = 50; // Reduced from 200 to save memory

// ─── Sync stats (legacy compat) ─────────────────────
let totalEventsSent = 0;
let totalEventsLocal = 0;
let lastSyncTime: string | null = null;
let lastError: string | null = null;

/**
 * Generate a unique event ID.
 */
function generateEventId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `evt_${ts}_${rand}`;
}

/**
 * Dispatch a business event to NOUR OS.
 * - Deduplicates within 5-minute window
 * - Critical events bypass queue and send immediately
 * - Non-critical events also send immediately but queue for retry on failure
 * - Writes to local events.jsonl AND fires HTTP to cloud
 */
export async function dispatchEvent(
  type: NourOsEventType,
  data: Record<string, unknown>
): Promise<void> {
  // Deduplication check
  if (isDuplicate(type, data)) {
    analytics.totalDeduplicated++;
    log.debug("Event deduplicated, skipping", { type });
    return;
  }

  const event: NourOsEvent = {
    type,
    timestamp: new Date().toISOString(),
    source: "nickstire",
    data,
    eventId: generateEventId(),
  };

  analytics.totalDispatched++;
  analytics.lastEventAt = event.timestamp;
  analytics.eventsByType[type] = (analytics.eventsByType[type] || 0) + 1;

  // Store in memory for admin dashboard
  EVENT_LOG.push(event);
  if (EVENT_LOG.length > MAX_EVENT_LOG) EVENT_LOG.shift();

  // 1. Write to local NOUR OS events.jsonl (fast, synchronous)
  writeToLocalEventBus(event);

  // 2. Push to cloud endpoint
  const isCritical = CRITICAL_EVENTS.has(type);

  if (isCritical) {
    // Critical events: send immediately, queue for retry on failure
    try {
      await pushToCloud(event);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      lastError = errMsg;
      log.warn("Critical event cloud push failed, queuing retry", { type, error: errMsg });
      scheduleRetry(event, 0);
    }
  } else {
    // Non-critical: fire and forget, queue for retry on failure
    pushToCloud(event).catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      lastError = errMsg;
      log.warn("Cloud push failed (non-blocking), queuing retry", { type, error: errMsg });
      scheduleRetry(event, 0);
    });
  }
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
    analytics.totalLocalWrites++;
  } catch (err) {
    log.error("Failed to write to local event bus", {
      path: NOUR_OS_EVENTS_PATH,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Push event to statenour-os cloud endpoint (with circuit breaker)
 */
async function pushToCloud(event: NourOsEvent): Promise<void> {
  const start = Date.now();

  await cloudCB.call(async () => {
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

    const latency = Date.now() - start;
    recordCloudLatency(latency);
    totalEventsSent++;
    analytics.totalCloudPushes++;
    analytics.lastCloudSuccessAt = new Date().toISOString();
    lastSyncTime = new Date().toISOString();
  });
}

// ─── Retry Queue Processor ──────────────────────────
const RETRY_INTERVAL_MS = 10_000; // Check retry queue every 10 seconds
let retryTimer: ReturnType<typeof setInterval> | null = null;

async function processRetryQueue(): Promise<void> {
  if (retryQueue.length === 0) return;

  const now = Date.now();
  const ready = retryQueue.filter((q) => now >= q.nextRetryAt);

  for (const item of ready) {
    const idx = retryQueue.indexOf(item);
    if (idx !== -1) retryQueue.splice(idx, 1);

    try {
      await pushToCloud(item.event);
      log.info("Retry succeeded", {
        type: item.event.type,
        eventId: item.event.eventId,
        attempt: item.attempts + 1,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      analytics.totalCloudFailures++;
      analytics.lastCloudErrorAt = new Date().toISOString();
      analytics.lastCloudError = errMsg;
      scheduleRetry(item.event, item.attempts + 1);
    }
  }
}

export function startRetryProcessor(): void {
  if (retryTimer) return;
  retryTimer = setInterval(() => {
    processRetryQueue().catch((err) => {
      log.warn("Retry queue processing failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, RETRY_INTERVAL_MS);
  log.info("NOUR OS Bridge retry processor started (10s interval)");
}

export function stopRetryProcessor(): void {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

// NOTE: startRetryProcessor() is called from server startup in _core/index.ts
// Do NOT auto-start here — it causes side effects during imports and tests

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

/** Booking stage changed */
export function onStageChanged(details: {
  bookingId: number;
  phone: string;
  stage: string;
  refCode: string | null;
}) {
  return dispatchEvent("nickstire:stage-change", {
    bookingId: details.bookingId,
    phone: details.phone,
    stage: details.stage,
    refCode: details.refCode || null,
  });
}

/** Google review detected */
export function onReviewDetected(details: {
  rating: number;
  reviewText: string;
  customerName: string;
}) {
  return dispatchEvent("nickstire:review", {
    rating: details.rating,
    reviewText: details.reviewText,
    customerName: details.customerName,
  });
}

/** SMS campaign batch completed */
export function onCampaignResult(details: {
  campaignId: number;
  sent: number;
  failed: number;
  campaignType: string;
}) {
  return dispatchEvent("nickstire:campaign-result", {
    campaignId: details.campaignId,
    sent: details.sent,
    failed: details.failed,
    campaignType: details.campaignType,
  });
}

/** After-hours emergency request */
export function onEmergencyRequest(details: {
  name: string;
  phone: string;
  description: string;
  urgency: string;
}) {
  return dispatchEvent("nickstire:emergency", {
    name: details.name,
    phone: details.phone,
    description: details.description,
    urgency: details.urgency,
  });
}

// ─── Admin Dashboard API ─────────────────────────────

/** Get recent events for admin dashboard */
export function getRecentEvents(limit = 50): NourOsEvent[] {
  return EVENT_LOG.slice(-limit).reverse();
}

/** Get sync status for admin dashboard (legacy + enhanced) */
export function getSyncStatus(): {
  totalEventsLocal: number;
  totalEventsSent: number;
  lastSyncTime: string | null;
  lastError: string | null;
  eventsInMemory: number;
  localPath: string;
  cloudUrl: string;
  retryQueueSize: number;
  cloudHealthy: boolean;
  analytics: Omit<EventAnalytics, "cloudLatencySamples">;
} {
  return {
    totalEventsLocal,
    totalEventsSent,
    lastSyncTime,
    lastError,
    eventsInMemory: EVENT_LOG.length,
    localPath: NOUR_OS_EVENTS_PATH,
    cloudUrl: STATENOUR_URL,
    retryQueueSize: retryQueue.length,
    cloudHealthy,
    analytics: getEventAnalytics(),
  };
}

// ─── Vendor Health Alerts ─────────────────────────────

/** Track which vendors were previously down so we can detect recovery */
const previousVendorStates = new Map<string, "healthy" | "degraded" | "down" | "not_configured">();

/**
 * Dispatch vendor health snapshot to NOUR OS.
 * Detects state transitions (healthy->down, down->healthy) and dispatches alerts.
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

      // Also fire Telegram alert for vendor down
      try {
        const { alertVendorDown } = await import("./services/telegram");
        const firstError = result.checks.find(c => !c.passed)?.error;
        alertVendorDown(result.vendor, firstError);
      } catch {
        // Telegram alert is best-effort
      }

      console.error(`[ALERT] Vendor ${result.vendor} degraded: ${prev} -> ${result.status}`);
    }

    if (prev && (prev === "down" || prev === "degraded") && result.status === "healthy") {
      // Vendor recovered — notify
      await dispatchEvent("nickstire:vendor_recovered", {
        vendor: result.vendor,
        previousStatus: prev,
        currentStatus: result.status,
      });

      try {
        const { alertVendorRecovered } = await import("./services/telegram");
        alertVendorRecovered(result.vendor);
      } catch {
        // Telegram alert is best-effort
      }

      console.info(`[bridge:recovery] Vendor ${result.vendor} recovered: ${prev} -> ${result.status}`);
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
      const clockedIn = load.techs.filter((t: any) => t.clockedIn).length;
      const freeBays = load.bays.filter((b: any) => !b.occupied).length;
      dispatchData = { techsClockedIn: clockedIn, freeBays: freeBays, totalBays: load.bays.length };
    } catch (err) {
      console.error("[NourOSBridge] Dispatch load fetch failed:", err instanceof Error ? err.message : err);
    }

    let qcData: Record<string, unknown> = {};
    try {
      const { getQcStats } = await import("./services/qcService");
      const qc = await getQcStats();
      qcData = { qcPassRate: qc.passRate, qcPending: qc.qcPending, comebacks30d: qc.comebacks30d };
    } catch (err) {
      console.error("[NourOSBridge] QC stats fetch failed:", err instanceof Error ? err.message : err);
    }

    let riskData: Record<string, unknown> = {};
    try {
      const { getPromiseRiskSummary } = await import("./services/promiseRisk");
      const risk = await getPromiseRiskSummary();
      riskData = { atRisk: risk.atRisk, likelyLate: risk.likelyLate, overdue: risk.overdue };
    } catch (err) {
      console.error("[NourOSBridge] Promise risk fetch failed:", err instanceof Error ? err.message : err);
    }

    let declinedData: Record<string, unknown> = {};
    try {
      const { getDeclinedWorkStats } = await import("./services/declinedWorkRecovery");
      const declined = await getDeclinedWorkStats();
      declinedData = { declinedValue30d: declined.totalDeclinedValue, declinedItems30d: declined.totalDeclinedItems };
    } catch (err) {
      console.error("[NourOSBridge] Declined work stats fetch failed:", err instanceof Error ? err.message : err);
    }

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
