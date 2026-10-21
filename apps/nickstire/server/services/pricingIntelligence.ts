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
 * 2026-10-21: the collections signal that replaced it (unpaid-invoice
 * concentrations per service, a daily Telegram) is deleted too. An invoice in
 * this system is a CLOSED job and money is taken on a separate register, so
 * paymentStatus cannot say paid or unpaid (Nour, 2026-10-21).
 *
 * The decline-reason objection analytics + operator coaching scripts are
 * retained (they read REAL decline reasons when callers pass them), with
 * unverifiable claims stripped from the scripts in the same pass —
 * every factual claim in a script now traces to shared/business.ts.
 */

import { BUSINESS } from "@shared/business";
import { getGoogleReviews } from "../google-reviews";

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
