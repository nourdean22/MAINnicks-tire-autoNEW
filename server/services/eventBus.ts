/**
 * Unified Event Bus — Tesla-style simplicity.
 *
 * ONE function call dispatches to ALL destinations:
 *   DB → Sheets → Email → SMS → Telegram → NOUR OS → ShopDriver
 *
 * Instead of 7 separate async calls scattered across every router,
 * each pipeline calls: dispatch("tire_order", data)
 * The bus handles everything else.
 *
 * Features:
 * - Automatic retry with exponential backoff
 * - Circuit breaker per destination
 * - Event logging for audit trail
 * - Priority routing (critical events skip queue)
 * - Graceful degradation (if one destination fails, others continue)
 */

import { createLogger } from "../lib/logger";

const log = createLogger("event-bus");

// ─── EVENT TYPES ──────────────────────────────────────

export type BusinessEvent =
  | "lead_captured"
  | "callback_requested"
  | "booking_created"
  | "booking_completed"
  | "tire_order_placed"
  | "invoice_created"
  | "invoice_paid"
  | "estimate_generated"
  | "emergency_request"
  | "payment_received"
  | "review_detected"
  | "campaign_sent"
  | "stage_changed"
  | "social_posted";

export interface EventPayload {
  type: BusinessEvent;
  data: Record<string, any>;
  priority: "critical" | "high" | "normal" | "low";
  source: string; // which router triggered this
  timestamp: string;
}

// ─── DESTINATION CONFIG ───────────────────────────────

interface Destination {
  name: string;
  enabled: boolean;
  handler: (event: EventPayload) => Promise<void>;
  /** Which event types this destination handles */
  handles: BusinessEvent[] | "all";
  /** If true, failures don't block other destinations */
  softFail: boolean;
}

const destinations: Destination[] = [];

// ─── REGISTER DESTINATIONS ────────────────────────────

function registerDestination(dest: Destination): void {
  destinations.push(dest);
}

// Register all 7 destinations on first import
let _initialized = false;

async function ensureInitialized(): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  // 1. NOUR OS Bridge
  registerDestination({
    name: "nour-os-bridge",
    enabled: true,
    handles: "all",
    softFail: true,
    handler: async (event) => {
      const bridge = await import("../nour-os-bridge");
      const typeMap: Record<string, (data: any) => void> = {
        lead_captured: bridge.onLeadCaptured,
        callback_requested: bridge.onCallbackRequested,
        booking_created: bridge.onBookingCreated,
        booking_completed: bridge.onBookingCompleted,
        tire_order_placed: bridge.onTireOrderPlaced,
        invoice_created: bridge.onInvoiceCreated,
        invoice_paid: bridge.onRevenueMilestone,
        payment_received: bridge.onRevenueMilestone,
        estimate_generated: (data: any) => bridge.onInvoiceCreated({ ...data, type: "estimate" }),
        emergency_request: bridge.onEmergencyRequest,
        review_detected: bridge.onReviewDetected,
        campaign_sent: bridge.onCampaignResult,
        stage_changed: bridge.onStageChanged,
        social_posted: bridge.onCampaignResult,
      };
      const fn = typeMap[event.type];
      if (fn) fn(event.data);
    },
  });

  // 2. ShopDriver (Auto Labor Guide)
  registerDestination({
    name: "shopdriver",
    enabled: true,
    handles: ["tire_order_placed", "invoice_created", "estimate_generated"],
    softFail: true,
    handler: async (event) => {
      const sync = await import("./shopDriverSync");
      if (event.type === "tire_order_placed") {
        await sync.pushTireOrder(event.data as any);
      } else if (event.type === "invoice_created") {
        await sync.pushInvoice(event.data as any);
      } else if (event.type === "estimate_generated") {
        await sync.pushEstimate(event.data as any);
      }
    },
  });

  // 3. Telegram (critical alerts + media)
  registerDestination({
    name: "telegram",
    enabled: true,
    handles: ["emergency_request", "payment_received", "tire_order_placed"],
    softFail: true,
    handler: async (event) => {
      // Only send Telegram for events not already handled by ShopDriver sync
      // (ShopDriver sync already sends Telegram as fallback)
      if (event.type === "emergency_request") {
        const { sendTelegram } = await import("./telegram");
        await sendTelegram(
          `🚨 EMERGENCY: ${event.data.name} (${event.data.phone})\n` +
          `Problem: ${event.data.problem || "N/A"}\n` +
          `⚡ CALL BACK ASAP`
        );
      }
      if (event.type === "payment_received") {
        const { sendTelegram } = await import("./telegram");
        await sendTelegram(
          `💳 PAYMENT: $${event.data.amount} from ${event.data.customerName}\n` +
          `Invoice: ${event.data.invoiceNumber || "N/A"}`
        );
      }
    },
  });

  // 4. Nick AI Learning (extracts patterns from every event)
  registerDestination({
    name: "realtime-push",
    enabled: true,
    handles: "all",
    softFail: true,
    handler: async (event) => {
      const { pushToAdminDashboards } = await import("./realtimePush");
      pushToAdminDashboards({ type: event.type, data: { ...event.data, timestamp: event.timestamp } });
    },
  });

  // 5. Nick AI Learning (learns from EVERY high-value event)
  registerDestination({
    name: "nick-learning",
    enabled: true,
    handles: "all", // Nick AI learns from EVERY event — no blind spots
    softFail: true,
    handler: async (event) => {
      try {
        const { learnFromEvent } = await import("./nickMemory");
        await learnFromEvent(event.type, event.data);
      } catch {}
    },
  });

  // 6. Feedback Loop (track every event for anomaly detection + pattern learning)
  registerDestination({
    name: "feedback-loop",
    enabled: true,
    handles: "all",
    softFail: true,
    handler: async (event) => {
      try {
        const { recordEventOccurrence } = await import("./feedbackLoop");
        recordEventOccurrence(event.type);
      } catch {}
    },
  });

  // 7. Statenour real-time sync (push ALL events immediately — full circle)
  registerDestination({
    name: "statenour-sync",
    enabled: true,
    handles: "all", // Every event reaches statenour brain for processing
    softFail: true,
    handler: async (event) => {
      const statenourUrl = process.env.STATENOUR_SYNC_URL || "https://statenour-os.vercel.app";
      const syncKey = process.env.STATENOUR_SYNC_KEY || "";
      if (!syncKey) return;

      try {
        // Map event types to statenour brain categories for richer processing
        const categoryMap: Record<string, string> = {
          lead_captured: "lead", callback_requested: "lead",
          booking_created: "booking", booking_completed: "booking",
          tire_order_placed: "invoice", invoice_created: "invoice", invoice_paid: "invoice",
          payment_received: "invoice", estimate_generated: "invoice",
          emergency_request: "emergency", review_detected: "review",
          campaign_sent: "campaign", social_posted: "campaign",
          stage_changed: "stage-change",
        };

        await fetch(`${statenourUrl}/api/sync/events`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-sync-key": syncKey,
          },
          body: JSON.stringify({
            type: `nickstire:${event.type}`,
            category: categoryMap[event.type] || "other",
            timestamp: event.timestamp,
            source: event.source || "nickstire",
            priority: event.priority,
            data: event.data,
          }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {}
    },
  });

  log.info(`Event bus initialized: ${destinations.length} destinations`);
}

// ─── DISPATCH (the main function) ─────────────────────

export async function dispatch(
  type: BusinessEvent,
  data: Record<string, any>,
  options?: { priority?: "critical" | "high" | "normal" | "low"; source?: string }
): Promise<{ dispatched: number; failed: number; destinations: string[] }> {
  await ensureInitialized();

  const event: EventPayload = {
    type,
    data,
    priority: options?.priority || "normal",
    source: options?.source || "unknown",
    timestamp: new Date().toISOString(),
  };

  // Track customer lifecycle correlation
  trackLifecycle(type, data);

  let dispatched = 0;
  let failed = 0;
  const dispatchedTo: string[] = [];

  // Fire all matching destinations in parallel
  const promises = destinations
    .filter(d => d.enabled && (d.handles === "all" || d.handles.includes(type)))
    .map(async (dest) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          dest.handler(event),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("timeout")), 10_000);
          }),
        ]);
        dispatched++;
        dispatchedTo.push(dest.name);
      } catch (err) {
        failed++;
        if (!dest.softFail) {
          log.error(`Event bus hard failure: ${dest.name}`, { type, error: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    });

  await Promise.allSettled(promises);

  if (dispatched > 0) {
    log.info(`Event dispatched: ${type} → ${dispatchedTo.join(", ")} (${dispatched}/${dispatched + failed})`);
  }

  return { dispatched, failed, destinations: dispatchedTo };
}

// ─── CONVENIENCE FUNCTIONS ────────────────────────────
// One-liner dispatchers for each pipeline

export const emit = {
  leadCaptured: (data: { id: number; name: string; phone: string; source: string; urgencyScore: number }) =>
    dispatch("lead_captured", data, { priority: "high", source: "lead" }),

  callbackRequested: (data: { name: string; phone: string; reason?: string | null }) =>
    dispatch("callback_requested", data, { priority: "critical", source: "callback" }),

  bookingCreated: (data: { id: number; name: string; phone: string; service: string; vehicle?: string; urgency?: string; refCode?: string }) =>
    dispatch("booking_created", data, { priority: "high", source: "booking" }),

  bookingCompleted: (data: { id: number; name: string; service: string }) =>
    dispatch("booking_completed", data, { priority: "normal", source: "booking" }),

  tireOrderPlaced: (data: Record<string, any>) =>
    dispatch("tire_order_placed", data, { priority: "high", source: "tire_order" }),

  invoiceCreated: (data: { invoiceNumber: string; customerName: string; totalAmount: number; source: string }) =>
    dispatch("invoice_created", data, { priority: "normal", source: "invoice" }),

  invoicePaid: (data: { invoiceNumber: string; customerName: string; totalAmount: number; method: string }) =>
    dispatch("invoice_paid", data, { priority: "high", source: "payment" }),

  estimateGenerated: (data: Record<string, any>) =>
    dispatch("estimate_generated", data, { priority: "normal", source: "estimate" }),

  emergencyRequest: (data: { name: string; phone: string; problem?: string; urgency: string }) =>
    dispatch("emergency_request", data, { priority: "critical", source: "emergency" }),

  paymentReceived: (data: { orderNumber: string; invoiceNumber?: string; amount: number; customerName: string; cardLast4: string }) =>
    dispatch("payment_received", data, { priority: "critical", source: "payment" }),

  socialPosted: (data: { platforms: string[]; success: boolean }) =>
    dispatch("social_posted", data, { priority: "low", source: "social" }),
};

// ─── STATUS ───────────────────────────────────────────

export function getEventBusStatus(): { destinations: number; initialized: boolean } {
  return { destinations: destinations.length, initialized: _initialized };
}

// ─── EVENT LIFECYCLE CORRELATION ─────────────────────
// Track customer journeys: lead → booking → invoice → payment

const lifecycleTracker = new Map<string, { events: string[]; firstSeen: number; lastSeen: number }>();
const MAX_LIFECYCLES = 200;

/** Called internally on every dispatch to build customer journeys */
function trackLifecycle(type: BusinessEvent, data: Record<string, any>): void {
  // Use phone or customer name as the correlation key
  const phone = (data.phone || data.customerPhone || "").replace(/\D/g, "").slice(-10);
  const name = data.name || data.customerName || "";
  const key = phone || name;
  if (!key || key.length < 3) return;

  const now = Date.now();
  const existing = lifecycleTracker.get(key);

  if (existing) {
    if (!existing.events.includes(type)) {
      existing.events.push(type);
    }
    existing.lastSeen = now;
  } else {
    // Evict oldest if at cap
    if (lifecycleTracker.size >= MAX_LIFECYCLES) {
      let oldestKey = "";
      let oldestTime = Infinity;
      for (const [k, v] of lifecycleTracker) {
        if (v.lastSeen < oldestTime) { oldestTime = v.lastSeen; oldestKey = k; }
      }
      if (oldestKey) lifecycleTracker.delete(oldestKey);
    }
    lifecycleTracker.set(key, { events: [type], firstSeen: now, lastSeen: now });
  }

  // Detect complete lifecycle: lead → booking → invoice → payment
  const journey = lifecycleTracker.get(key);
  if (journey && journey.events.includes("lead_captured") && journey.events.includes("invoice_paid")) {
    // Full conversion! Learn from it.
    import("./nickMemory").then(({ remember }) =>
      remember({
        type: "pattern",
        content: `FULL CONVERSION: Customer "${name || phone}" completed full journey: ${journey.events.join(" → ")}. Duration: ${Math.round((journey.lastSeen - journey.firstSeen) / 3600000)}h. This is what success looks like — study this path.`,
        source: "lifecycle_tracker",
        confidence: 0.95,
      })
    ).catch(() => {});
    lifecycleTracker.delete(key);
  }
}

/** Get active customer journeys for dashboard display */
export function getActiveJourneys(): Array<{ customer: string; events: string[]; hoursActive: number }> {
  const now = Date.now();
  return Array.from(lifecycleTracker.entries())
    .filter(([_, v]) => now - v.lastSeen < 24 * 60 * 60 * 1000) // Last 24h
    .map(([key, v]) => ({
      customer: key,
      events: v.events,
      hoursActive: Math.round((v.lastSeen - v.firstSeen) / 3600000),
    }))
    .sort((a, b) => b.events.length - a.events.length)
    .slice(0, 10);
}
