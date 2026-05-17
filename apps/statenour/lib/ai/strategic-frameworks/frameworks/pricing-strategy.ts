import type { StrategicFramework } from "../types";

/**
 * Pricing Strategy — for tactical price-setting decisions. Cost-plus
 * vs value-based, decoy effect, anchor pricing, bundling, penetration
 * vs skim. The math + the psychology.
 */
export const pricingStrategy: StrategicFramework = {
  id: "pricing-strategy",
  name: "Pricing Strategy (Tactical)",
  oneLiner: "Cost-plus vs value-based · decoy / anchor / bundle · penetration vs skim · margin-vs-volume tradeoff.",
  triggers: [
    /\b(price|pricing|priced|prices)\b/i,
    /\b(markup|markups?|margins?|cost\s*plus|cost\s+plus)\b/i,
    /\b(bundle|bundling|bundles?|package|packages?|combo)\b/i,
    /\b(decoy|anchor)\b/i,
    /\b(charge|charging)\s+(more|less|extra)\b/i,
    /\b(penetration\s+price|skim(ming)?)\b/i,
    /\b(price\s+elasticity|price\s+sensitive)\b/i,
    /\bhow\s+much\s+(should|do|to)\s+(we|i|the\s+shop)\s+(charge|price)\b/i,
    /\bwhat\s+markup\b/i,
  ],
  antiTriggers: [
    /\bpric(e|ing)\s+of\s+(admission|fame|freedom)/i, // idioms
    // entertainment / event prices · not strategic pricing
    /\b(ticket|show|movie|concert|game|event|admission|venue)\s+pric(es?|ing)\b/i,
    /\b(uber|lyft|gas|fuel|airport|cab|taxi)\s+pric(es?|ing)\b/i,
  ],
  weight: 1.0,
  lens: `Apply Pricing Strategy. Pricing is a math + psychology problem.

Math layer:
  · Cost-plus  · cost × markup. Fast, defensible, leaves money on table.
  · Value-based · price = % of value delivered. Hardest to set, highest ceiling.
  · Margin × volume tradeoff · doubling price + halving volume often
    increases profit AND service quality (less throughput pressure).

Psychology layer:
  · Anchor first · the FIRST number frames everything that follows.
  · Decoy effect · 3-tier pricing where the middle tier is "useless"
    pulls 80% to the top. Used by basically every premium SaaS.
  · Bundling   · turns commodity items into a felt package. Aligning
    with brakes is a higher-trust sale than aligning by itself.
  · Pain-of-paying · subscription hides per-use cost; per-transaction
    surfaces it.

Walk both layers. Don't just pick a number — explain what the number
SIGNALS to the customer + how it shapes the buying flow.`,
};
