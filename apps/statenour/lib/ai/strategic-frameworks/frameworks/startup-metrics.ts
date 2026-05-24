import type { StrategicFramework } from "../types";

/**
 * Startup Metrics Framework — KPI tracking for any business. Pick the
 * north-star, derive 3-5 leading indicators, ignore vanity metrics.
 */
export const startupMetrics: StrategicFramework = {
  id: "startup-metrics",
  name: "Startup Metrics Framework",
  oneLiner: "North-star metric → 3-5 leading indicators → no vanity. What you measure becomes what you optimize.",
  triggers: [
    /\b(KPI|kpis|metric|metrics|north[\s-]star)\b/i,
    /\b(measure|track(ing)?)\s+(success|progress|performance)\b/i,
    /\b(dashboard|scorecard|p\s*&\s*l\s+(metric|kpi))\b/i,
    /\b(MRR|ARR|ARPU|LTV|CAC|NPS|CSAT|churn(\s+rate)?)\b/i,
    /\b(leading\s+(indicator|metric)|lagging\s+(indicator|metric))\b/i,
    /\b(vanity\s+metric|actionable\s+metric)\b/i,
    /\bwhat\s+(should|do)\s+(we|i)\s+(measure|track)\b/i,
  ],
  antiTriggers: [
    // 'metrics' on body / fitness / sport / mechanical · NOT business KPI
    /\b(body|fitness|health|running|workout|sports?|bike|swim|gym|cycling|hiking)\s+(composition\s+|fat\s+|mass\s+|weight\s+|performance\s+)?metrics?\b/i,
    /\b(track|measure)\s+(my|your|the)\s+(running|fitness|body|workout|health|bike|swim|hiking)\s+metrics?\b/i,
    /\b(car|engine|gpu|cpu|computer|laptop|phone|device)\s+metrics?\b/i,
    // 2026-05-23 · Wave E · dedup with north-star-metric.ts. When the
    // user names "north star" explicitly, that's a north-star-metric
    // question · NOT a generic startup-metrics overview. north-star
    // is the more specific lens · let it win the slot.
    /\bnorth\s+star\s+(metric|kpi)/i,
  ],
  weight: 1.0,
  lens: `Apply the Startup Metrics framework. The structure of measurement
shapes behavior · pick wrong, and the team optimizes the wrong thing.

  1. ONE NORTH-STAR · the metric that, if it's healthy, the business
     is healthy. For a tire shop: monthly customers served × average
     ticket size × retention rate. For SaaS: weekly active users.
     For a content business: paid subscribers. ONE number that all
     decisions ladder up to.

  2. 3-5 LEADING INDICATORS · what predicts the north-star next
     quarter? These should be controllable today.
       · Inputs (e.g., ad spend, technician hours)
       · Conversion rates (lead → quote → close)
       · Quality signals (NPS, return-customer %)

  3. KILL VANITY METRICS · website visits, social followers, "engagements."
     If a metric goes up and the business doesn't change, it's vanity.
     Replace with the action it should have caused.

Force the framework: name the north-star, name 3 leading indicators,
name 1-2 vanity metrics that should be retired.`,
};
