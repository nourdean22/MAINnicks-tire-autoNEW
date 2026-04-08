/**
 * Customer Journey Tracker -- tracks the full lifecycle:
 * first_touch -> estimate -> booking -> service -> invoice -> review -> referral -> repeat
 *
 * Persists journey stages to nickMemory for cross-system visibility.
 * Lightweight: memory writes only, no new DB tables.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("journey-tracker");

// ─── JOURNEY EVENT TYPES ─────────────────────────────

export type JourneyEventType =
  | "first_chat"
  | "estimate_requested"
  | "lead_created"
  | "booking_made"
  | "work_order_created"
  | "invoice_paid"
  | "review_left"
  | "referral_sent"
  | "repeat_visit";

// ─── IN-MEMORY JOURNEY CACHE ─────────────────────────
// Quick lookup for repeat visit detection without DB queries

interface JourneyEntry {
  events: Array<{ type: JourneyEventType; timestamp: string }>;
  firstSeen: number;
  lastInvoiceDate: number | null;
}

const journeyCache = new Map<string, JourneyEntry>();
const MAX_CACHE = 300;

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

// ─── MAIN FUNCTION ───────────────────────────────────

/**
 * Track a customer journey event. Persists to nickMemory for cross-system visibility.
 */
export async function trackJourneyEvent(params: {
  customerId?: number;
  phone?: string;
  eventType: JourneyEventType;
  metadata?: Record<string, any>;
}): Promise<{ daysSinceLastVisit?: number }> {
  const { customerId, phone, eventType, metadata } = params;
  const key = phone ? normalizePhone(phone) : customerId ? `cust_${customerId}` : null;

  if (!key || key.length < 5) {
    log.warn("Journey event skipped: no valid customer identifier", { eventType });
    return {};
  }

  const now = Date.now();
  const timestamp = new Date().toISOString();
  let daysSinceLastVisit: number | undefined;

  // Update journey cache
  let entry = journeyCache.get(key);
  if (!entry) {
    // Evict oldest if at cap
    if (journeyCache.size >= MAX_CACHE) {
      let oldestKey = "";
      let oldestTime = Infinity;
      for (const [k, v] of journeyCache) {
        if (v.firstSeen < oldestTime) { oldestTime = v.firstSeen; oldestKey = k; }
      }
      if (oldestKey) journeyCache.delete(oldestKey);
    }
    entry = { events: [], firstSeen: now, lastInvoiceDate: null };
    journeyCache.set(key, entry);
  }

  entry.events.push({ type: eventType, timestamp });

  // Compute repeat visit metrics
  if (eventType === "repeat_visit" || eventType === "invoice_paid") {
    if (entry.lastInvoiceDate) {
      daysSinceLastVisit = Math.floor((now - entry.lastInvoiceDate) / (24 * 60 * 60 * 1000));
    }
    if (eventType === "invoice_paid") {
      entry.lastInvoiceDate = now;
    }
  }

  // Persist to nickMemory
  try {
    const { remember } = await import("./nickMemory");
    const customerLabel = metadata?.name || phone || `#${customerId}`;
    const extraInfo = daysSinceLastVisit !== undefined ? ` (${daysSinceLastVisit}d since last visit)` : "";

    await remember({
      type: "customer",
      content: `[journey] ${customerLabel}: ${eventType} at ${timestamp}${extraInfo}. Stage ${entry.events.length} in lifecycle. Path: ${entry.events.map(e => e.type).join(" -> ")}`,
      source: "journey_tracker",
      confidence: 0.8,
    });
  } catch (err) {
    log.warn("Journey memory write failed", { error: err instanceof Error ? err.message : String(err) });
  }

  log.info(`Journey event: ${eventType}`, { key: key.slice(-4), daysSinceLastVisit });
  return { daysSinceLastVisit };
}

/**
 * Check if a customer has prior invoices (for repeat visit detection).
 * Uses DB lookup when cache misses.
 */
export async function checkRepeatCustomer(phone: string): Promise<{ isRepeat: boolean; priorInvoiceCount: number; daysSinceLastVisit?: number }> {
  const key = normalizePhone(phone);
  if (key.length < 10) return { isRepeat: false, priorInvoiceCount: 0 };

  // Check cache first
  const cached = journeyCache.get(key);
  if (cached && cached.lastInvoiceDate) {
    const invoiceEvents = cached.events.filter(e => e.type === "invoice_paid");
    const daysSince = Math.floor((Date.now() - cached.lastInvoiceDate) / (24 * 60 * 60 * 1000));
    return { isRepeat: invoiceEvents.length > 0, priorInvoiceCount: invoiceEvents.length, daysSinceLastVisit: daysSince };
  }

  // DB fallback
  try {
    const { getDb } = await import("../db");
    const { invoices } = await import("../../drizzle/schema");
    const { sql, desc } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { isRepeat: false, priorInvoiceCount: 0 };

    const priorInvoices = await db.select({
      id: invoices.id,
      invoiceDate: invoices.invoiceDate,
    }).from(invoices)
      .where(sql`RIGHT(${invoices.customerPhone}, 10) = ${key}`)
      .orderBy(desc(invoices.invoiceDate))
      .limit(5);

    if (priorInvoices.length > 0) {
      const lastDate = priorInvoices[0].invoiceDate ? new Date(priorInvoices[0].invoiceDate).getTime() : null;
      const daysSince = lastDate ? Math.floor((Date.now() - lastDate) / (24 * 60 * 60 * 1000)) : undefined;

      // Warm cache
      if (!journeyCache.has(key)) {
        journeyCache.set(key, {
          events: [{ type: "invoice_paid", timestamp: new Date(lastDate || Date.now()).toISOString() }],
          firstSeen: Date.now(),
          lastInvoiceDate: lastDate,
        });
      }

      return { isRepeat: true, priorInvoiceCount: priorInvoices.length, daysSinceLastVisit: daysSince };
    }
  } catch (e) { console.warn("[services/journeyTracker] operation failed:", e); }

  return { isRepeat: false, priorInvoiceCount: 0 };
}

/**
 * Get journey summary for a customer (dashboard use).
 */
export function getJourneySummary(phone: string): {
  stages: Array<{ type: JourneyEventType; timestamp: string }>;
  totalEvents: number;
  daysSinceFirstContact: number;
} | null {
  const key = normalizePhone(phone);
  const entry = journeyCache.get(key);
  if (!entry) return null;

  return {
    stages: entry.events,
    totalEvents: entry.events.length,
    daysSinceFirstContact: Math.floor((Date.now() - entry.firstSeen) / (24 * 60 * 60 * 1000)),
  };
}
