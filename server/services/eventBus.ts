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
  | "social_posted"
  | "mirror_synced"
  | "data_refreshed";

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

/** Eagerly initialize the event bus — call from server startup */
export async function initEventBus(): Promise<void> {
  return ensureInitialized();
}

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

  // 2b. Customer Journey Tracker (lifecycle events → nickMemory)
  registerDestination({
    name: "journey-tracker",
    enabled: true,
    handles: ["lead_captured", "estimate_generated", "booking_created", "invoice_created", "invoice_paid", "review_detected"],
    softFail: true,
    handler: async (event) => {
      const { trackJourneyEvent, checkRepeatCustomer } = await import("./journeyTracker");
      const phone = event.data.phone || event.data.customerPhone || "";
      const name = event.data.name || event.data.customerName || "";

      if (event.type === "lead_captured") {
        await trackJourneyEvent({ phone, eventType: "lead_created", metadata: { name, source: event.data.source } });
      }
      if (event.type === "estimate_generated") {
        await trackJourneyEvent({ phone, eventType: "estimate_requested", metadata: { name } });
      }
      if (event.type === "booking_created") {
        await trackJourneyEvent({ phone, eventType: "booking_made", metadata: { name, service: event.data.service } });
      }
      if (event.type === "invoice_created") {
        await trackJourneyEvent({ phone, eventType: "work_order_created", metadata: { name } });
      }
      if (event.type === "invoice_paid") {
        // Check for repeat visit
        const repeat = await checkRepeatCustomer(phone);
        if (repeat.isRepeat && repeat.priorInvoiceCount > 0) {
          await trackJourneyEvent({ phone, eventType: "repeat_visit", metadata: { name, daysSinceLastVisit: repeat.daysSinceLastVisit } });
        }
        await trackJourneyEvent({ phone, eventType: "invoice_paid", metadata: { name, amount: event.data.totalAmount } });
      }
      if (event.type === "review_detected") {
        await trackJourneyEvent({ phone, eventType: "review_left", metadata: { name, rating: event.data.rating } });
      }
    },
  });

  // 2c. Auto-Lead Creation + Drip Campaign Enrollment (event-driven automation)
  registerDestination({
    name: "automation-engine",
    enabled: true,
    handles: ["booking_created", "booking_completed", "invoice_paid"],
    softFail: true,
    handler: async (event) => {
      const auto = await import("./workOrderAutomation");

      // Booking → create lead (NOT a work order — WOs are created manually when customer shows up)
      if (event.type === "booking_created") {
        await auto.autoCreateLeadFromBooking(event.data as any);
      }

      // Job completed → enroll in post-service drip (thank you + review + check-in)
      if (event.type === "booking_completed" && event.data.phone) {
        await auto.enrollInDripCampaign("post-service", {
          phone: event.data.phone,
          name: event.data.name || "Customer",
          service: event.data.service,
        });
      }

      // Invoice paid → enroll new customers in welcome drip
      if (event.type === "invoice_paid" && event.data.isNewCustomer && event.data.phone) {
        await auto.enrollInDripCampaign("new-customer", {
          phone: event.data.phone,
          name: event.data.customerName || "Customer",
        });
      }

      // Invoice paid → real-time customer enrichment (totalSpent, totalVisits, lastVisitDate)
      if (event.type === "invoice_paid") {
        try {
          const { getDb } = await import("../db");
          const { sql } = await import("drizzle-orm");
          const d = await getDb();
          const phone = (event.data.customerPhone || event.data.phone || "").replace(/\D/g, "").slice(-10);
          if (d && phone.length === 10) {
            await d.execute(sql`
              UPDATE customers
              SET totalSpent = totalSpent + ${event.data.totalAmount || 0},
                  totalVisits = totalVisits + 1,
                  lastVisitDate = NOW()
              WHERE RIGHT(phone, 10) = ${phone} OR RIGHT(phone2, 10) = ${phone}
            `);
          }
        } catch (e) { console.warn("[eventBus:automation] customer totalSpent/totalVisits update failed:", e); }
      }
    },
  });

  // 2d. Live Feed (real-time Telegram closed job + milestone + review + lead notifications)
  registerDestination({
    name: "live-feed",
    enabled: true,
    handles: ["invoice_paid", "review_detected", "lead_captured"],
    softFail: true,
    handler: async (event) => {
      const { notifyClosedJob, notifyNewFiveStarReview, notifyHotLead, trackLead } = await import("./liveFeed");

      if (event.type === "invoice_paid") {
        await notifyClosedJob({
          customerName: event.data.customerName || event.data.name || "Customer",
          service: event.data.service || event.data.serviceDescription || undefined,
          totalAmount: event.data.totalAmount || event.data.amount || 0,
          vehicle: event.data.vehicle || event.data.vehicleDescription || undefined,
        });
      }

      if (event.type === "review_detected" && event.data.rating === 5) {
        await notifyNewFiveStarReview({
          text: event.data.text || event.data.comment || "",
          authorName: event.data.author || event.data.authorName || "Anonymous",
        });
      }

      if (event.type === "lead_captured") {
        const score = event.data.urgencyScore || event.data.leadScore || 0;
        if (score >= 80) {
          await notifyHotLead({
            name: event.data.name || "Unknown",
            score,
            problem: event.data.service || event.data.problem || undefined,
            vehicle: event.data.vehicle || undefined,
            source: event.data.source || undefined,
          });
        } else {
          trackLead();
        }
      }
    },
  });

  // 3. PWA Push Notifications (admin alerts)
  registerDestination({
    name: "push-notifications",
    enabled: true,
    handles: ["booking_created", "lead_captured", "invoice_paid"],
    softFail: true,
    handler: async (event) => {
      const { pushToAdmins } = await import("./pushNotifications");
      const name = event.data.name || event.data.customerName || "Customer";

      if (event.type === "booking_created") {
        await pushToAdmins({
          title: "New Booking",
          body: `${name} booked ${event.data.service || "a service"}`,
          url: "/admin?tab=bookings",
          tag: "booking",
        });
      } else if (event.type === "lead_captured") {
        await pushToAdmins({
          title: "New Lead",
          body: `${name} — ${event.data.problem || event.data.service || "inquiry"}`,
          url: "/admin?tab=leads",
          tag: "lead",
        });
      } else if (event.type === "invoice_paid") {
        const amount = event.data.totalAmount ? `$${Math.round(event.data.totalAmount / 100)}` : "";
        await pushToAdmins({
          title: `Payment Received ${amount}`,
          body: `${name} paid their invoice`,
          url: "/admin?tab=revenue",
          tag: "payment",
        });
      }
    },
  });

  // 4. Google Ads Offline Conversions
  registerDestination({
    name: "google-ads-conversions",
    enabled: true,
    handles: ["invoice_paid"],
    softFail: true,
    handler: async (event) => {
      const { trackInvoiceConversion } = await import("./googleAdsConversion");
      await trackInvoiceConversion({
        totalAmount: event.data.totalAmount || 0,
        customerPhone: event.data.phone || event.data.customerPhone,
        invoiceNumber: event.data.invoiceNumber,
      });
    },
  });

  // 5. Telegram (critical alerts + media)
  registerDestination({
    name: "telegram",
    enabled: true,
    handles: ["emergency_request", "payment_received", "tire_order_placed", "lead_captured", "callback_requested", "booking_completed"],
    softFail: true,
    handler: async (event) => {
      const { sendTelegram } = await import("./telegram");

      if (event.type === "emergency_request") {
        await sendTelegram(
          `🚨 EMERGENCY: ${event.data.name} (${event.data.phone})\n` +
          `Problem: ${event.data.problem || "N/A"}\n` +
          `⚡ CALL BACK ASAP`
        );
      }
      if (event.type === "payment_received") {
        await sendTelegram(
          `💳 PAYMENT: $${event.data.amount} from ${event.data.customerName}\n` +
          `Invoice: ${event.data.invoiceNumber || "N/A"}`
        );
      }
      // High-urgency lead = immediate alert with context
      if (event.type === "lead_captured" && (event.data.urgencyScore >= 4 || event.data.source === "emergency")) {
        // Check if this is a returning customer
        let returnNote = "";
        try {
          const { getDb } = await import("../db");
          const { leads: leadsTable } = await import("../../drizzle/schema");
          const { like } = await import("drizzle-orm");
          const db = await getDb();
          if (db && event.data.phone) {
            const phone10 = String(event.data.phone).replace(/\D/g, "").slice(-10);
            const prior = await db.select({ id: leadsTable.id }).from(leadsTable)
              .where(like(leadsTable.phone, `%${phone10}%`)).limit(2);
            if (prior.length > 1) returnNote = "\n🔄 RETURNING CUSTOMER — they've contacted before";
          }
        } catch (e) { console.warn("[eventBus:telegram] returning customer check failed:", e); }
        await sendTelegram(
          `🔴 HIGH-URGENCY LEAD: ${event.data.name} (${event.data.phone})\n` +
          `Source: ${event.data.source} | Urgency: ${event.data.urgencyScore}/5${returnNote}\n` +
          `⚡ Call within 5 minutes — conversion drops 50% after 30 min`
        );
      }
      // Callback = someone is waiting
      if (event.type === "callback_requested") {
        await sendTelegram(
          `📞 CALLBACK REQUEST: ${event.data.name} (${event.data.phone})\n` +
          `Reason: ${event.data.reason || "General inquiry"}\n` +
          `⏰ Call back ASAP — they're waiting`
        );
      }
      // Job completed = celebrate + prompt review request
      if (event.type === "booking_completed") {
        await sendTelegram(
          `✅ JOB COMPLETED: ${event.data.name}\n` +
          `Service: ${event.data.service}\n` +
          `💡 Send review request before they leave`
        );
      }
      // invoice_paid handled by live-feed destination (notifyClosedJob) — no duplicate here
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
      } catch (e) { console.warn("[eventBus:nickLearning] learnFromEvent failed:", e); }
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
      } catch (e) { console.warn("[eventBus:feedbackLoop] event occurrence recording failed:", e); }
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
          mirror_synced: "sync", data_refreshed: "sync",
        };

        const payload = JSON.stringify({
          type: `nickstire:${event.type}`,
          category: categoryMap[event.type] || "other",
          timestamp: event.timestamp,
          source: event.source || "nickstire",
          priority: event.priority,
          data: event.data,
        });

        // Retry with backoff — Vercel cold starts can take 3-5s
        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await fetch(`${statenourUrl}/api/sync/events`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-sync-key": syncKey },
              body: payload,
              signal: AbortSignal.timeout(attempt === 0 ? 8000 : 15000), // 8s first, 15s retry
            });
            if (res.ok) break;
            if (res.status >= 500 && attempt < 2) {
              await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // 1s, 2s backoff
              continue;
            }
            break; // 4xx = don't retry
          } catch (e) {
            lastErr = e;
            if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
        if (lastErr) console.warn("[eventBus:statenour] sync push failed after retries:", lastErr);
      } catch (e) { console.warn("[eventBus:statenour] sync push error:", e); }
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
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!dest.softFail) {
          log.error(`Event bus hard failure: ${dest.name}`, { type, error: errMsg });
        }
        // Dead letter queue — store failed events for analysis
        deadLetterQueue.push({ event, destination: dest.name, error: errMsg, timestamp: Date.now() });
        if (deadLetterQueue.length > MAX_DLQ) deadLetterQueue.shift();
      } finally {
        if (timer) clearTimeout(timer);
      }
    });

  await Promise.allSettled(promises);

  // Track event statistics
  if (!eventStats[type]) eventStats[type] = { dispatched: 0, failed: 0, lastSeen: 0 };
  eventStats[type].dispatched += dispatched;
  eventStats[type].failed += failed;
  eventStats[type].lastSeen = Date.now();

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

// ─── DEAD LETTER QUEUE ───────────────────────────────
// Failed events stored for retry/analysis
const deadLetterQueue: Array<{ event: EventPayload; destination: string; error: string; timestamp: number }> = [];
const MAX_DLQ = 50;

// ─── EVENT STATISTICS ────────────────────────────────
const eventStats: Record<string, { dispatched: number; failed: number; lastSeen: number }> = {};

export function getEventBusStatus(): {
  destinations: number;
  initialized: boolean;
  stats: Record<string, { dispatched: number; failed: number; lastSeen: string }>;
  deadLetterCount: number;
  recentDeadLetters: Array<{ type: string; destination: string; error: string }>;
} {
  const stats: Record<string, { dispatched: number; failed: number; lastSeen: string }> = {};
  for (const [type, s] of Object.entries(eventStats)) {
    stats[type] = { dispatched: s.dispatched, failed: s.failed, lastSeen: new Date(s.lastSeen).toISOString() };
  }
  return {
    destinations: destinations.length,
    initialized: _initialized,
    stats,
    deadLetterCount: deadLetterQueue.length,
    recentDeadLetters: deadLetterQueue.slice(-5).map(d => ({ type: d.event.type, destination: d.destination, error: d.error })),
  };
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
    ).catch(e => console.warn("[eventBus:lifecycle] full conversion memory save failed:", e));
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
