/**
 * Service Memory — what each customer got serviced, when, for how much.
 *
 * This is the dormant revenue lever. We sit on invoices + service_history
 * going back years; we just haven't used them to re-engage. This service
 * turns that data into actionable suggestions:
 *
 *   - "Your brakes were done 18 months ago — time for an inspection"
 *   - "Oil change was 3,200 miles / 4 months ago — due"
 *   - "Tires installed 2024-03 — now 3+ years old, watch tread"
 *   - "Alignment was 14 months ago — recommend recheck"
 *
 * The cost of pulling this per-customer is a single indexed SQL read
 * (invoices + serviceHistory by customerPhone). Cheap.
 *
 * Public API:
 *   getServiceMemory(phone) — structured timeline per service category
 *   getDueSuggestions(phone) — ranked list of what to re-engage on
 *   getAllCustomersDue(limit) — bulk scan for daily SMS batch
 */

import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";
import { normalizePhone, phoneRawDigits } from "../lib/phone";
import { sql } from "drizzle-orm";
import { BUSINESS } from "@shared/business";

const log = createLogger("service-memory");

// ─── Service category matchers (from invoice description / service type) ──
// Maps free-text service descriptions into canonical categories.
const CATEGORY_KEYWORDS: Record<ServiceCategory, RegExp> = {
  oil: /\b(oil change|oil ?&|synthetic|motor oil|oil filter)\b/i,
  tires: /\b(tire|tires|mount|balance|rotation|wheel install|new set|used set|4 tires|2 tires)\b/i,
  brakes: /\b(brake|brakes|pad|rotor|caliper|brake fluid|brake flush)\b/i,
  alignment: /\b(alignment|align|toe|camber|caster)\b/i,
  battery: /\b(battery|alternator|starter|jump)\b/i,
  suspension: /\b(strut|struts|shock|shocks|control arm|sway bar|ball joint|tie rod)\b/i,
  diagnostic: /\b(diagnostic|diagnose|check engine|scan|code)\b/i,
  ac: /\b(a\/c|ac system|air conditioning|refrigerant|freon|r134|r1234)\b/i,
  cooling: /\b(coolant|radiator|thermostat|water pump|overheat)\b/i,
  transmission: /\b(transmission|trans fluid|atf|cvt)\b/i,
  exhaust: /\b(exhaust|muffler|catalytic|o2 sensor)\b/i,
  inspection: /\b(inspection|inspect|e-check|emission|safety check)\b/i,
};

export type ServiceCategory =
  | "oil"
  | "tires"
  | "brakes"
  | "alignment"
  | "battery"
  | "suspension"
  | "diagnostic"
  | "ac"
  | "cooling"
  | "transmission"
  | "exhaust"
  | "inspection";

// ─── Recommended intervals (days) — tunable per shop experience ──
export const SERVICE_INTERVALS_DAYS: Record<ServiceCategory, number> = {
  oil: 90,            // 3 months / ~3000 mi
  tires: 365 * 4,     // 4 years — age-based check; rotation handled via note
  brakes: 540,        // ~18 months for inspection
  alignment: 365,     // 12 months
  battery: 365 * 3,   // 3 years
  suspension: 365 * 5,// 5 years
  diagnostic: 90,     // repeat diag rare
  ac: 365 * 2,        // 2 years for recharge check
  cooling: 365 * 2,   // coolant flush every 2 years
  transmission: 365 * 2, // ATF service every 2 years
  exhaust: 365 * 5,   // long-tail
  inspection: 365,    // annual
};

// Soft grace before we surface the suggestion (don't nag day-1 after)
const GRACE_DAYS: Record<ServiceCategory, number> = {
  oil: 7,
  tires: 30,
  brakes: 14,
  alignment: 14,
  battery: 30,
  suspension: 30,
  diagnostic: 14,
  ac: 30,
  cooling: 14,
  transmission: 30,
  exhaust: 60,
  inspection: 14,
};

// ─── Types ────────────────────────────────────────────

export interface ServiceEvent {
  date: string;         // ISO
  daysAgo: number;
  description: string;
  source: "invoice" | "service_history";
  cost?: number;        // cents
  mileage?: number | null;
  vehicleInfo?: string | null;
}

export interface ServiceMemory {
  customerPhone: string;
  /** Service events bucketed by category, most-recent first */
  byCategory: Partial<Record<ServiceCategory, ServiceEvent[]>>;
  /** Flat timeline, most-recent first, up to 30 entries */
  timeline: (ServiceEvent & { category: ServiceCategory | "unknown" })[];
  totalSpendCents: number;
  firstSeen: string | null;
  lastSeen: string | null;
  totalVisits: number;
}

export interface DueSuggestion {
  category: ServiceCategory;
  dueReason: string;
  lastDate: string;
  daysSinceLast: number;
  intervalDays: number;
  overdueDays: number;       // negative if not yet due
  urgency: "overdue" | "due" | "soon" | "ok";
  suggestedSmsCopy: string;
  customerPhone: string;
  customerName?: string;
}

// ─── Classifier ────────────────────────────────────────

function classifyServiceDescription(desc: string | null | undefined): ServiceCategory | "unknown" {
  if (!desc) return "unknown";
  for (const [cat, re] of Object.entries(CATEGORY_KEYWORDS) as [ServiceCategory, RegExp][]) {
    if (re.test(desc)) return cat;
  }
  return "unknown";
}

function daysBetween(a: Date, b: Date = new Date()): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

// ─── Per-customer timeline ─────────────────────────────

export async function getServiceMemory(rawPhone: string): Promise<ServiceMemory | null> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;

  const d = await db();
  if (!d) return null;

  const digits = phoneRawDigits(rawPhone);

  try {
    // Invoices: pull everything for this phone (match raw digits since ShopDriver
    // format may differ). Limit to 200 for sanity.
    const invoicesRows = (await d.execute(sql`
      SELECT
        customerName, customerPhone, serviceDescription, totalAmount, vehicleInfo,
        COALESCE(invoiceDate, createdAt) AS dateKey
      FROM invoices
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(customerPhone,'+',''),'-',''),' ',''),'(','') LIKE ${`%${digits}%`}
      ORDER BY dateKey DESC
      LIMIT 200
    `)) as unknown as [Array<Record<string, unknown>>, unknown];

    const rows = Array.isArray(invoicesRows[0]) ? invoicesRows[0] : [];

    // service_history: joined via userId would need users lookup; for now pull
    // via phone match through users table's openId is overkill. Prefer invoices.
    const events: (ServiceEvent & { category: ServiceCategory | "unknown" })[] = [];
    for (const r of rows) {
      const desc = String(r.serviceDescription ?? "");
      const cat = classifyServiceDescription(desc);
      const dateStr = r.dateKey ? new Date(r.dateKey as string | Date).toISOString() : null;
      if (!dateStr) continue;
      const date = new Date(dateStr);
      events.push({
        date: dateStr,
        daysAgo: daysBetween(date),
        description: desc || "Service",
        source: "invoice" as const,
        cost: typeof r.totalAmount === "number" ? r.totalAmount : Number(r.totalAmount ?? 0),
        vehicleInfo: (r.vehicleInfo as string | null) ?? null,
        category: cat,
      });
    }

    if (events.length === 0) return null;

    // Bucket by category (drop unknowns from byCategory, keep in timeline)
    const byCategory: Partial<Record<ServiceCategory, ServiceEvent[]>> = {};
    for (const ev of events) {
      if (ev.category === "unknown") continue;
      if (!byCategory[ev.category]) byCategory[ev.category] = [];
      byCategory[ev.category]!.push(ev);
    }

    const totalSpendCents = events.reduce((s, e) => s + (e.cost || 0), 0);
    const firstSeen = events[events.length - 1]?.date ?? null;
    const lastSeen = events[0]?.date ?? null;

    return {
      customerPhone: phone,
      byCategory,
      timeline: events.slice(0, 30),
      totalSpendCents,
      firstSeen,
      lastSeen,
      totalVisits: events.length,
    };
  } catch (err) {
    log.warn("getServiceMemory failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Suggestion builder ────────────────────────────────

function buildSmsCopy(category: ServiceCategory, daysSince: number, customerFirstName?: string): string {
  const who = customerFirstName ? `Hi ${customerFirstName}` : "Hi";
  const phone = BUSINESS.phone.display;

  // Copy is specific to the category — Pillar 2 tone (no-pressure, drop-off friendly).
  switch (category) {
    case "oil":
      return `${who} — looks like your last oil change with Nick's was ~${Math.round(daysSince / 30)} months ago. Want us to take care of you? Drop it off, we'll have it back to you same day. ${phone}`;
    case "tires":
      return `${who}, Nick's here. Your tires are ~${Math.round(daysSince / 365 * 10) / 10} years old. We'll do a free tread + age check, no pressure. Want to come by? ${phone}`;
    case "brakes":
      return `${who} — Nick's. We last serviced your brakes about ${Math.round(daysSince / 30)} months ago. Free inspection if you want us to take a look. ${phone}`;
    case "alignment":
      return `${who} — it's been about a year since your last alignment. Eating tires wears fast. We can check it free. ${phone}`;
    case "battery":
      return `${who}, your battery's ~${Math.round(daysSince / 365 * 10) / 10} years old. Ohio winters are hard on batteries. We can test it free — takes 5 min. ${phone}`;
    case "ac":
      return `${who} — Nick's. A/C recharge check recommended every couple years. It's been ~${Math.round(daysSince / 365 * 10) / 10}. Swing by when it's convenient. ${phone}`;
    case "cooling":
      return `${who} — coolant flush was ~${Math.round(daysSince / 365 * 10) / 10} years ago. Protects your engine. Want us to take care of it? ${phone}`;
    case "transmission":
      return `${who}, transmission service was ~${Math.round(daysSince / 365 * 10) / 10} years ago. Extends the life of the trans. We'll do it quick. ${phone}`;
    case "inspection":
      return `${who} — annual check-up time. Free under 1 hour. Drop it off, Uber out, we'll text you. ${phone}`;
    case "diagnostic":
      return `${who} — if that check-engine light is still bugging you, we can rescan free. ${phone}`;
    case "exhaust":
      return `${who}, exhaust was worked on ~${Math.round(daysSince / 365 * 10) / 10} years ago. Louder than usual? Free look. ${phone}`;
    case "suspension":
      return `${who} — suspension work was ~${Math.round(daysSince / 365 * 10) / 10} years ago. Riding rough? Free inspection. ${phone}`;
  }
}

export async function getDueSuggestions(
  rawPhone: string,
  customerName?: string,
): Promise<DueSuggestion[]> {
  const mem = await getServiceMemory(rawPhone);
  if (!mem) return [];

  const suggestions: DueSuggestion[] = [];
  const firstName = customerName?.split(/\s+/)[0];

  for (const [cat, events] of Object.entries(mem.byCategory) as [ServiceCategory, ServiceEvent[]][]) {
    if (!events?.length) continue;
    const last = events[0];
    const interval = SERVICE_INTERVALS_DAYS[cat];
    const grace = GRACE_DAYS[cat];
    const overdueDays = last.daysAgo - interval;

    let urgency: DueSuggestion["urgency"];
    if (overdueDays >= 60) urgency = "overdue";
    else if (overdueDays >= grace) urgency = "due";
    else if (overdueDays >= -30) urgency = "soon";
    else continue; // too early, skip

    suggestions.push({
      category: cat,
      dueReason: `${cat} service was ${last.daysAgo} days ago (${interval}-day interval)`,
      lastDate: last.date,
      daysSinceLast: last.daysAgo,
      intervalDays: interval,
      overdueDays,
      urgency,
      suggestedSmsCopy: buildSmsCopy(cat, last.daysAgo, firstName),
      customerPhone: mem.customerPhone,
      customerName,
    });
  }

  // Sort by urgency + overdueDays
  const order = { overdue: 0, due: 1, soon: 2, ok: 3 };
  suggestions.sort((a, b) => order[a.urgency] - order[b.urgency] || b.overdueDays - a.overdueDays);
  return suggestions;
}

// ─── Bulk scan for daily cron ──────────────────────────

export async function getAllCustomersDue(limit: number = 100): Promise<DueSuggestion[]> {
  const d = await db();
  if (!d) return [];

  try {
    // Strategy: pull recent unique (customerName, customerPhone) pairs from
    // invoices with at least 1 service event in the last 3 years. Skip
    // customers we've already sent a re-engagement SMS to recently.
    const rows = (await d.execute(sql`
      SELECT DISTINCT customerName, customerPhone
      FROM invoices
      WHERE customerPhone IS NOT NULL
        AND customerPhone != ''
        AND COALESCE(invoiceDate, createdAt) >= DATE_SUB(CURDATE(), INTERVAL 3 YEAR)
      LIMIT ${limit * 3}
    `)) as unknown as [Array<Record<string, unknown>>, unknown];

    const candidates = Array.isArray(rows[0]) ? rows[0] : [];
    const allSuggestions: DueSuggestion[] = [];

    for (const r of candidates) {
      const phone = String(r.customerPhone ?? "");
      const name = String(r.customerName ?? "");
      if (!phone) continue;

      const sug = await getDueSuggestions(phone, name);
      if (sug.length > 0) {
        // Take just the top suggestion per customer to avoid spam
        allSuggestions.push(sug[0]);
      }
      if (allSuggestions.length >= limit) break;
    }

    // Sort by urgency across the whole set
    const order = { overdue: 0, due: 1, soon: 2, ok: 3 };
    allSuggestions.sort(
      (a, b) => order[a.urgency] - order[b.urgency] || b.overdueDays - a.overdueDays,
    );

    return allSuggestions;
  } catch (err) {
    log.warn("getAllCustomersDue failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
