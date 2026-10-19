/**
 * The copies nickstire sends to bdnick.info (StateNour) carry no customer name, phone or
 * customer-written text (job 2026-10-18-bdnick-prune wave 4; apps/nickstire/AGENTS.md section 5).
 *
 * Allowlists, not blocklists: a key nobody listed here is dropped, so a new identifier field
 * (customerName, fullName, email, a nested contact) fails safe instead of leaking. Every function
 * returns new objects and never mutates its input: nickstire's own digests, Telegram alerts and
 * admin screens read the same data and keep the names.
 */

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

function pick(src: unknown, keys: readonly string[]): Rec {
  const out: Rec = {};
  if (!isRec(src)) return out;
  for (const k of keys) if (Object.hasOwn(src, k)) out[k] = src[k];
  return out;
}

const pickEach = (list: unknown, keys: readonly string[]): Rec[] =>
  Array.isArray(list) ? list.filter(isRec).map((item) => pick(item, keys)) : [];

// ─── Business sync (cron/jobs/statenourSync.ts -> /api/sync/business) ───

const CUSTOMER_INTELLIGENCE_KEYS = [
  "available", "reason", "totalCustomers", "activeCustomers", "lapsedCustomers", "lostCustomers",
  "newThisMonth", "retentionRate", "avgLifetimeValue", "avgTicket", "servicePatterns",
  "dayOfWeekPattern", "peakHours", "atRiskUnavailable", "bookingPatternsUnavailable",
] as const;

/** actionPlan is left out: it is prose that names the top at-risk customer (with phone) and the top spender. */
function customerIntelligence(ci: unknown): Rec | null {
  if (!isRec(ci)) return null;
  return {
    ...pick(ci, CUSTOMER_INTELLIGENCE_KEYS),
    ...(Array.isArray(ci.topSpenders) ? { topSpenders: pickEach(ci.topSpenders, ["total", "visits"]) } : {}),
    ...(Array.isArray(ci.atRiskCustomers) ? { atRiskCustomers: pickEach(ci.atRiskCustomers, ["lastVisit", "daysSince"]) } : {}),
  };
}

const DECLINED_KEYS = ["measured", "source", "sourceNote", "totalRecoverable", "customerCount", "safetyItemCount"] as const;
const DECLINED_ITEM_KEYS = ["workOrderId", "orderNumber", "vehicle", "value", "hasSafety"] as const;
/** recoveryNotes is left out: staff outreach notes ("left a voicemail for ...") name the customer. */
const DECLINED_LINE_KEYS = ["description", "total", "declineReason", "safetyRelated", "outreachAt", "recoveryMethod"] as const;

function declinedWork(dw: unknown): Rec | null {
  if (!isRec(dw)) return null;
  return {
    ...pick(dw, DECLINED_KEYS),
    topItems: (Array.isArray(dw.topItems) ? dw.topItems.filter(isRec) : []).map((item) => ({
      ...pick(item, DECLINED_ITEM_KEYS),
      lines: pickEach(item.lines, DECLINED_LINE_KEYS),
    })),
  };
}

/**
 * The business sync body for StateNour. Top-level blocks are aggregates except the four
 * replaced here; nickAI keeps only the count because a memory is free text that can name a
 * customer ("FULL CONVERSION: Customer ...", "VIP customers: ...").
 */
export function redactBusinessSyncForStatenour(payload: Rec): Rec {
  return {
    ...payload,
    customerIntelligence: customerIntelligence(payload.customerIntelligence),
    customerJourneys: pickEach(payload.customerJourneys, ["events", "hoursActive"]),
    declinedWork: declinedWork(payload.declinedWork),
    nickAI: isRec(payload.nickAI) ? pick(payload.nickAI, ["memoryCount"]) : null,
  };
}

// ─── Events (nour-os-bridge.ts pushToCloud, eventBus "statenour-sync") ───

/**
 * Event data keys that are ids, enums, money, counts or system state. Not here, so dropped:
 * customer, customerName, name, phone, customerId, cardLast4, and customer- or staff-written
 * text (callback reason and notes, emergency description, estimate symptom, review text,
 * cross-sell reason, work-order note, changedBy).
 */
const EVENT_DATA_KEYS = [
  // ids and references
  "bookingId", "leadId", "callbackId", "workOrderId", "orderNumber", "invoiceNumber", "refCode",
  "campaignId", "predictionId",
  // business facts
  "service", "vehicle", "urgency", "urgencyScore", "source", "kind", "type", "stage", "newStatus",
  "fromStatus", "toStatus", "tire", "totalAmount", "amount", "method", "rating", "issueCount",
  "estimateLow", "estimateHigh", "confidence", "sent", "queued", "failed", "campaignType",
  // mirror sync counts
  "newInvoices", "newCustomers", "updatedCustomers", "totalInvoicesFetched",
  // vendor health
  "totalVendors", "healthyCount", "degradedCount", "downCount", "vendors", "vendor",
  "previousStatus", "currentStatus", "errors",
  // shop floor snapshot
  "active", "inProgress", "blocked", "overdue", "readyForPickup", "totalValueInProgress", "byStatus",
  "techsClockedIn", "freeBays", "totalBays", "qcPassRate", "qcPending", "comebacks30d", "atRisk",
  "likelyLate", "declinedValue30d", "declinedItems30d", "declinedMeasured30d", "declinedSourceNote30d",
] as const;

/** The shop's own social content (draft captions, publish results): no customer in it, sent whole. */
const SHOP_CONTENT_TYPES = new Set(["social_draft:sync", "social_posted"]);

export function redactEventDataForStatenour(type: string, data: unknown): Rec {
  if (SHOP_CONTENT_TYPES.has(type) && isRec(data)) return { ...data };
  return pick(data, EVENT_DATA_KEYS);
}
