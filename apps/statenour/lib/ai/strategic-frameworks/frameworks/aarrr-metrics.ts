import type { StrategicFramework } from "../types";

/**
 * AARRR Pirate Metrics (Dave McClure) — five funnel stages with
 * conversion rates measured at each gate. The point is to find the
 * one stage with the worst leak and fix that, not blast more traffic
 * into a leaky bucket.
 */
export const aarrrMetrics: StrategicFramework = {
  id: "aarrr-metrics",
  name: "AARRR Pirate Metrics",
  oneLiner: "Acquisition · Activation · Retention · Referral · Revenue. Each stage is a conversion %. Fix the worst leak first.",
  triggers: [
    /\b(aarrr|pirate\s+metrics)\b/i,
    /\b(funnel\s+(metrics|conversion|leak|drop[\s-]?off))\b/i,
    /\b(activation\s+(rate|metric))\b/i,
    /\b(conversion\s+rate\s+at\s+(each|every)\s+(stage|step))/i,
    /\b(where\s+are\s+we\s+losing\s+(customers|users|leads))/i,
    /\b(stage[\s-]by[\s-]stage\s+conversion)/i,
    /\b(funnel\s+health|funnel\s+audit)\b/i,
  ],
  weight: 0.95,
  lens: `Apply AARRR Pirate Metrics. Five stages, each with its own
conversion rate · the leak is wherever the % drops most.

  1. ACQUISITION · stranger arrives. Site visit · ad click · phone
     call · walk-in. Measured as cost-per-acquisition (CPA).
  2. ACTIVATION · first valuable experience. Booked appointment ·
     completed first service · added to CRM. Measured as % of
     acquisitions who activate.
  3. RETENTION · they come back. Second service · second booking ·
     month-2 still using. Measured as % who return within window.
  4. REFERRAL · they tell someone else. Reviewed · shared · sent
     a friend. Measured as referrals per active customer.
  5. REVENUE · they pay (and pay more over time). Average ticket ·
     LTV trajectory. Measured as $ per customer per period.

The fastest improvement is almost never "more acquisition." Most
businesses have a stage where 60-80% drops out · fixing that doubles
output without spending more on top-of-funnel. Common culprits ·
booking flow friction (activation), no follow-up after first
service (retention), no review-ask mechanic (referral).

Surface · the conversion % at each stage · where's the worst leak ·
what's the cheapest fix that closes it.`,
};
