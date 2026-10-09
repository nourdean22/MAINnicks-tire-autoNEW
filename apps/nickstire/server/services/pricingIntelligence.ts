/**
 * Payment-Status Intelligence (formerly "Pricing Intelligence")
 *
 * revenue-truth-correction (2026-07-28): this module previously claimed
 * to measure ESTIMATE APPROVAL and recommended price moves from it
 * ("RAISE PRICE ... you're leaving money on the table" / "PRICE TOO
 * HIGH ... consider lowering") over Telegram. The underlying data was
 * invoices.paymentStatus — records that ALREADY became invoices —
 * where paid/partial was scored "approved" and pending scored
 * "declined/walked". That is payment/collection state, not a pricing
 * decision. Worse, the error is directionally biased: unpaid invoices
 * sit in pending, so a slow-collections month read as a pricing problem
 * and generated "lower your prices" advice. The recommender is deleted.
 *
 * What the data CAN honestly support — and what this module now does —
 * is a COLLECTIONS signal: which service categories are accumulating
 * unpaid invoices. That is real and actionable (chase payment), and the
 * alert says exactly that.
 *
 * Pricing recommendations stay out of this codebase until they can be
 * built on actual estimate decisions + cost structure (Quote Quality &
 * Profit Guard — blocked on parts/labor cost capture).
 *
 * The decline-reason objection analytics + operator coaching scripts are
 * retained (they read REAL decline reasons when callers pass them), with
 * unverifiable claims stripped from the scripts in the same pass —
 * every factual claim in a script now traces to shared/business.ts.
 */

import { createLogger } from "../lib/logger";
import { BUSINESS } from "@shared/business";
import { getGoogleReviews } from "../google-reviews";

const log = createLogger("payment-status-intel");

/** Calculate the "Objection Index" — how often each decline reason appears */
export function analyzeObjections(
  declineReasons: Array<{ service: string; reason: string }>
): Array<{ reason: string; count: number; percentage: number; services: string[] }> {
  const reasonMap = new Map<
    string,
    { count: number; services: Set<string> }
  >();

  for (const d of declineReasons) {
    const normalized = normalizeDeclineReason(d.reason);
    const entry = reasonMap.get(normalized) || {
      count: 0,
      services: new Set<string>(),
    };
    entry.count++;
    entry.services.add(d.service);
    reasonMap.set(normalized, entry);
  }

  const total = declineReasons.length || 1;

  return Array.from(reasonMap.entries())
    .map(([reason, data]) => ({
      reason,
      count: data.count,
      percentage: Math.round((data.count / total) * 100),
      services: Array.from(data.services),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Known service categories and their keyword matchers.
 * Invoices are categorized by matching serviceDescription against these.
 *
 * A SEPARATE taxonomy, not a copy of engines/shared.ts categorizeService:
 * Title Case labels printed in the collections alert, lowercase substring
 * keywords, first match wins. Outputs are pinned row by row, known
 * misclassifications included, in serviceCategorizers.golden.test.ts.
 */
const SERVICE_CATEGORIES: Record<string, string[]> = {
  "Oil Change": ["oil change", "oil & filter", "lube", "synthetic oil"],
  "Brakes": ["brake", "rotor", "pad", "caliper"],
  "Tires": ["tire", "mount", "balance", "alignment", "rotate"],
  "Suspension": ["strut", "shock", "suspension", "ball joint", "tie rod", "control arm"],
  "Engine": ["engine", "timing", "head gasket", "valve", "spark plug", "ignition"],
  "Transmission": ["transmission", "trans fluid", "trans flush"],
  "Exhaust": ["exhaust", "muffler", "catalytic", "pipe"],
  "Electrical": ["battery", "alternator", "starter", "electrical", "wiring"],
  "AC/Heating": ["ac ", "a/c", "compressor", "freon", "heater core", "hvac"],
  "Diagnostics": ["diagnostic", "check engine", "scan", "inspection"],
  "General Maintenance": ["flush", "coolant", "power steering", "belt", "hose", "filter"],
};

/**
 * Categorize a service description into one payment-alert label.
 */
function paymentAlertCategory(description: string): string {
  const lower = (description || "").toLowerCase();
  for (const [category, keywords] of Object.entries(SERVICE_CATEGORIES)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return category;
    }
  }
  return "Other";
}

/**
 * Payment-status breakdown per service category from live invoice data.
 *
 * MEASURES PAYMENT STATE, NOT ESTIMATE APPROVAL: every row here already
 * became an invoice; "unpaid" means paymentStatus is not paid/partial.
 * A category with high unpaid share has a collections problem (or a
 * data-entry lag) — it says nothing about whether the price was right.
 *
 * @param days Number of days to look back (default 30)
 */
export async function getServicePaymentBreakdown(days = 30): Promise<Array<{
  service: string;
  paidOrPartial: number;
  unpaid: number;
  total: number;
  unpaidShare: number; // 0-100, % of invoices in this category not yet paid/partial
}>> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    // A database it cannot reach is not "no invoices": throw, so the cron records a failure
    // (2026-10-09). An empty array below means a real read found nothing to analyze.
    if (!db) throw new Error("database not available: payment state is unknown, not empty");

    const [rows] = await db.execute(sql`
      SELECT serviceDescription, paymentStatus
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        AND serviceDescription IS NOT NULL
        AND serviceDescription != ''
    `);

    const invoiceRows = rows as Array<{ serviceDescription: string; paymentStatus: string }>;
    if (!invoiceRows || invoiceRows.length === 0) return [];

    // Aggregate by category
    const categoryStats: Record<string, { paidOrPartial: number; unpaid: number }> = {};

    for (const row of invoiceRows) {
      const category = paymentAlertCategory(row.serviceDescription);
      if (!categoryStats[category]) {
        categoryStats[category] = { paidOrPartial: 0, unpaid: 0 };
      }
      if (row.paymentStatus === "paid" || row.paymentStatus === "partial") {
        categoryStats[category].paidOrPartial++;
      } else {
        categoryStats[category].unpaid++;
      }
    }

    return Object.entries(categoryStats)
      .map(([service, stats]) => ({
        service,
        paidOrPartial: stats.paidOrPartial,
        unpaid: stats.unpaid,
        total: stats.paidOrPartial + stats.unpaid,
        unpaidShare: Math.round((stats.unpaid / (stats.paidOrPartial + stats.unpaid)) * 100),
      }))
      .filter((r) => r.total >= 3) // Need at least 3 data points
      .sort((a, b) => b.total - a.total);
  } catch (err: unknown) {
    // Rethrow: returning [] here read as "No invoice data to analyze" and cron_log recorded the
    // run as completed while the read had failed.
    log.error("Failed to compute payment breakdown:", { error: (err as Error).message });
    throw err;
  }
}

/**
 * Cron job (scheduler name: "pricing-intelligence", kept for cron_log
 * continuity): report unpaid-invoice concentrations per category.
 *
 * Alerts ONLY on collections facts. Never recommends price changes —
 * see the module header for why the old raise/lower alerts were invalid.
 */
export async function runPricingIntelligenceJob(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  const alerts: string[] = [];

  try {
    const rates = await getServicePaymentBreakdown(30);
    if (rates.length === 0) {
      return { recordsProcessed: 0, details: "No invoice data to analyze" };
    }

    for (const rate of rates) {
      // ≥40% of a category's invoices unpaid with real volume = money
      // sitting in receivables (or a paymentStatus data-entry gap —
      // both worth a look). Threshold is a triage prior, not a finding.
      if (rate.unpaidShare >= 40 && rate.unpaid >= 3) {
        alerts.push(
          `💵 UNPAID CONCENTRATION: ${rate.service} — ${rate.unpaid}/${rate.total} invoices (last 30d) not marked paid/partial. Chase payment or fix paymentStatus entries.`
        );
      }
    }

    // Send via Telegram if we have actionable alerts
    if (alerts.length > 0) {
      try {
        const { sendTelegram } = await import("./telegram");
        await sendTelegram(
          `💳 PAYMENT-STATUS CHECK (30-day)\n\n` +
          alerts.join("\n\n") +
          `\n\n📊 ${rates.length} service categories analyzed. This measures payment state on invoices — NOT estimate approval, NOT pricing.`
        );
      } catch (e) { log.warn("[services/pricingIntelligence] operation failed:", e); }

      try {
        const { remember } = await import("./nickMemory");
        await remember({
          type: "insight",
          content: `Payment-status check: ${alerts.length} unpaid concentrations. ${alerts.join(" | ").slice(0, 1500)}`,
          source: "pricing_intelligence",
          confidence: 0.85,
        });
      } catch (e) { log.warn("[services/pricingIntelligence] operation failed:", e); }
    }

    const details = `${rates.length} categories, ${alerts.length} unpaid-concentration alerts`;
    if (alerts.length > 0) log.info(`Payment-status check: ${details}`);
    return { recordsProcessed: rates.length, details };
  } catch (err: unknown) {
    // 2026-09-01 (audit F-9): rethrow — a swallowed error was recorded as `completed`.
    log.error("Payment-status job failed:", { error: (err as Error).message });
    throw err;
  }
}

function normalizeDeclineReason(reason: string): string {
  const lower = reason.toLowerCase().trim();
  if (/price|expensive|cost|afford|too much|budget/.test(lower)) return "price_concern";
  if (/time|wait|schedule|busy|later/.test(lower)) return "timing";
  if (/not sure|think about|second opinion|shop around/.test(lower)) return "shopping_around";
  if (/not needed|don.t need|unnecessary/.test(lower)) return "perceived_unnecessary";
  if (/trust|honest|scam|rip.off/.test(lower)) return "trust_issue";
  if (/diy|myself|friend|family/.test(lower)) return "self_repair";
  return "other";
}

/**
 * Generate coaching tips based on common objections.
 *
 * Claim discipline (revenue-truth-correction): every factual claim in
 * these scripts traces to shared/business.ts or the live site. Removed
 * from the previous version: "repair cost typically doubles" (invented),
 * "loaner or shuttle service" (not offered — the real offer is drop-off
 * + Uber from the lot), "early drop-off at 7:30 AM" (hours open 8 AM),
 * "20-30% less than dealership rates" (unverified), "24 months
 * warranty" (unverified), "400+ reviews" (stale — canonical count lives
 * in BUSINESS.reviews), "convert 3x better" (invented stat).
 */
export async function getObjectionCoaching(
  topObjection: string
): Promise<{ objection: string; script: string; tip: string }> {
  const googleData = await getGoogleReviews();
  const reviewRating = googleData?.rating ?? BUSINESS.reviews.rating;
  const reviewCount = googleData?.totalReviews ?? BUSINESS.reviews.count;
  const reviewCountDisplay = `${reviewCount.toLocaleString("en-US")}+`;
  const financingProviders = BUSINESS.financing.providers.join(", ");
  const coaching: Record<string, { script: string; tip: string }> = {
    price_concern: {
      script:
        `I understand the concern. Let me walk you through exactly what's on the estimate and what each part does. We also accept payment programs through ${financingProviders}; some don't require established credit, and the provider decides approval.`,
      tip: "Explain the estimate line by line, then offer financing. Never discount first.",
    },
    timing: {
      script:
        "I hear you. Easiest move: drop it off any morning — you can grab an Uber right from our lot and we'll text you the moment it's ready. First come, first served, 7 days a week.",
      tip: "Remove the inconvenience barrier with the real drop-off flywheel: keys in, Uber out, text when done.",
    },
    shopping_around: {
      script:
        "Absolutely, get a second opinion — we encourage it. Here's our written estimate to take with you. Compare it line for line.",
      tip: "Confidence, not desperation. Give them the estimate on paper. They usually come back.",
    },
    perceived_unnecessary: {
      script:
        "Let me show you exactly what I found — come under the car with me and look at the part yourself. I wouldn't recommend it if it wasn't needed.",
      tip: "Visual proof beats verbal explanation. Put them under their own car with a flashlight.",
    },
    trust_issue: {
      script:
        `I get it — this industry has a bad rep. Here's what we do differently: we show you the part before we replace it, we don't sell you what you don't need, and our Google reviews are public — ${reviewCountDisplay} of them averaging ${reviewRating} stars.`,
      tip: "Social proof and transparency. Show, don't tell. Let reviews do the heavy lifting.",
    },
    self_repair: {
      script:
        "If you're handy, that's great! Some jobs need special tools or a calibration pass — if you run into trouble, we're here. We charge by the job, not the hour.",
      tip: "Don't fight it. Give honest advice. They'll come back for the harder stuff.",
    },
    other: {
      script: "Help me understand what's holding you back. I want to make sure we find the right solution for you.",
      tip: "Ask open-ended questions. Listen more than you talk.",
    },
  };

  return {
    objection: topObjection,
    ...(coaching[topObjection] || coaching.other),
  };
}
