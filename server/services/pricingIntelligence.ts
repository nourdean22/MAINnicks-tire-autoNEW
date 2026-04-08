/**
 * Pricing Intelligence — Tracks estimate-to-close rates per service category
 * Identifies which services are being declined most and suggests pricing adjustments.
 * Feeds data for dynamic pricing decisions and objection coaching.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("pricing-intel");

export interface ServicePricingStats {
  service: string;
  estimateCount: number;
  approvedCount: number;
  declinedCount: number;
  approvalRate: number;
  avgEstimateAmount: number;
  avgApprovedAmount: number;
  totalRevenue: number;
  avgDaysToApprove: number;
}

export interface PricingInsight {
  service: string;
  approvalRate: number;
  recommendation: "lower" | "hold" | "raise" | "bundle";
  reason: string;
  suggestedAction: string;
}

/** Analyze approval rates and generate pricing insights */
export function analyzePricing(
  stats: ServicePricingStats[]
): PricingInsight[] {
  const insights: PricingInsight[] = [];

  for (const s of stats) {
    if (s.estimateCount < 5) continue; // Need enough data

    if (s.approvalRate < 0.4) {
      insights.push({
        service: s.service,
        approvalRate: s.approvalRate,
        recommendation: "lower",
        reason: `Only ${Math.round(s.approvalRate * 100)}% approval rate — customers are price-shopping`,
        suggestedAction: `Consider lowering ${s.service} estimates by 10-15% or adding a value bundle`,
      });
    } else if (s.approvalRate > 0.85) {
      insights.push({
        service: s.service,
        approvalRate: s.approvalRate,
        recommendation: "raise",
        reason: `${Math.round(s.approvalRate * 100)}% approval — you may be leaving money on the table`,
        suggestedAction: `Test raising ${s.service} estimates by 5-10%`,
      });
    } else if (s.approvalRate >= 0.4 && s.approvalRate < 0.6) {
      insights.push({
        service: s.service,
        approvalRate: s.approvalRate,
        recommendation: "bundle",
        reason: `${Math.round(s.approvalRate * 100)}% approval — borderline. Bundling may increase conversion`,
        suggestedAction: `Offer ${s.service} as part of a package deal with related services`,
      });
    } else {
      insights.push({
        service: s.service,
        approvalRate: s.approvalRate,
        recommendation: "hold",
        reason: `${Math.round(s.approvalRate * 100)}% approval — healthy range`,
        suggestedAction: `Maintain current pricing for ${s.service}`,
      });
    }
  }

  // Sort by approval rate (lowest first = most actionable)
  insights.sort((a, b) => a.approvalRate - b.approvalRate);

  log.info("Pricing analysis complete", {
    total: stats.length,
    insights: insights.length,
    lowApproval: insights.filter((i) => i.recommendation === "lower").length,
  });

  return insights;
}

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
 * Categorize a service description into a known category.
 */
function categorizeService(description: string): string {
  const lower = (description || "").toLowerCase();
  for (const [category, keywords] of Object.entries(SERVICE_CATEGORIES)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return category;
    }
  }
  return "Other";
}

/**
 * Compute approval rates per service category from live invoice data.
 * paid/partial = approved, pending = declined/walked.
 * @param days Number of days to look back (default 30)
 */
export async function getServiceApprovalRates(days = 30): Promise<Array<{
  service: string;
  approved: number;
  declined: number;
  total: number;
  approvalRate: number;
}>> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return [];

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
    const categoryStats: Record<string, { approved: number; declined: number }> = {};

    for (const row of invoiceRows) {
      const category = categorizeService(row.serviceDescription);
      if (!categoryStats[category]) {
        categoryStats[category] = { approved: 0, declined: 0 };
      }
      if (row.paymentStatus === "paid" || row.paymentStatus === "partial") {
        categoryStats[category].approved++;
      } else {
        categoryStats[category].declined++;
      }
    }

    return Object.entries(categoryStats)
      .map(([service, stats]) => ({
        service,
        approved: stats.approved,
        declined: stats.declined,
        total: stats.approved + stats.declined,
        approvalRate: Math.round((stats.approved / (stats.approved + stats.declined)) * 100),
      }))
      .filter((r) => r.total >= 3) // Need at least 3 data points
      .sort((a, b) => b.total - a.total);
  } catch (err: unknown) {
    log.error("Failed to compute approval rates:", { error: (err as Error).message });
    return [];
  }
}

/**
 * Run the full pricing intelligence cron job.
 * Queries DB, computes approval rates, alerts on over/under-priced services.
 */
export async function runPricingIntelligenceJob(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  const alerts: string[] = [];

  try {
    const rates = await getServiceApprovalRates(30);
    if (rates.length === 0) {
      return { recordsProcessed: 0, details: "No invoice data to analyze" };
    }

    for (const rate of rates) {
      if (rate.approvalRate > 85) {
        alerts.push(
          `💰 RAISE PRICE: ${rate.service} has ${rate.approvalRate}% approval (${rate.approved}/${rate.total}) — you're leaving money on the table`
        );
      } else if (rate.approvalRate < 40) {
        alerts.push(
          `📉 PRICE TOO HIGH: ${rate.service} has ${rate.approvalRate}% approval (${rate.approved}/${rate.total}) — consider lowering or bundling`
        );
      }
    }

    // Send via Telegram if we have actionable alerts
    if (alerts.length > 0) {
      try {
        const { sendTelegram } = await import("./telegram");
        await sendTelegram(
          `🏷️ PRICING INTELLIGENCE (30-day)\n\n` +
          alerts.join("\n\n") +
          `\n\n📊 ${rates.length} service categories analyzed`
        );
      } catch (e) { console.warn("[services/pricingIntelligence] operation failed:", e); }

      try {
        const { remember } = await import("./nickMemory");
        await remember({
          type: "insight",
          content: `Pricing intelligence: ${alerts.length} alerts. ${alerts.join(" | ").slice(0, 1500)}`,
          source: "pricing_intelligence",
          confidence: 0.85,
        });
      } catch (e) { console.warn("[services/pricingIntelligence] operation failed:", e); }
    }

    const details = `${rates.length} categories, ${alerts.length} pricing alerts`;
    if (alerts.length > 0) log.info(`Pricing intelligence: ${details}`);
    return { recordsProcessed: rates.length, details };
  } catch (err: unknown) {
    log.error("Pricing intelligence job failed:", { error: (err as Error).message });
    return { recordsProcessed: 0, details: `Failed: ${(err as Error).message}` };
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

/** Generate coaching tips based on common objections */
export function getObjectionCoaching(
  topObjection: string
): { objection: string; script: string; tip: string } {
  const coaching: Record<string, { script: string; tip: string }> = {
    price_concern: {
      script:
        "I understand the concern. Let me show you what happens if we don't address this now — the repair cost typically doubles. We also offer financing through Acima, Snap, Koalafi, or American First Finance — no credit check needed.",
      tip: "Lead with cost-of-delay, then offer financing. Never discount first.",
    },
    timing: {
      script:
        "I hear you. We can get this done in about [X hours]. Would it help if we offered a loaner or shuttle service? We also have early drop-off at 7:30 AM.",
      tip: "Remove the inconvenience barrier. Offer drop-off, shuttle, or same-day service.",
    },
    shopping_around: {
      script:
        "Absolutely, get a second opinion — we encourage it. Here's our written estimate. We're usually 20-30% less than dealership rates and we warranty our work for 24 months.",
      tip: "Confidence, not desperation. Give them the estimate on paper. They usually come back.",
    },
    perceived_unnecessary: {
      script:
        "Let me show you exactly what I found. [Show photo/video]. This is a safety concern because [explain risk]. I wouldn't recommend it if it wasn't needed.",
      tip: "Visual proof is everything. Photos and videos convert 3x better than verbal explanation.",
    },
    trust_issue: {
      script:
        "I get it — this industry has a bad rep. Here's what we do differently: we show you the part before we replace it, we don't sell you what you don't need, and we have 400+ Google reviews averaging 4.9 stars.",
      tip: "Social proof and transparency. Show, don't tell. Let reviews do the heavy lifting.",
    },
    self_repair: {
      script:
        "If you're handy, that's great! Just know this repair requires [special tool/alignment/calibration]. If you run into trouble, we're here. We charge by the job, not the hour.",
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
