import type { StrategicFramework } from "../types";

/**
 * 7 Powers (Hamilton Helmer) — durable competitive advantage taxonomy.
 * A "Power" is the rare condition that lets a business sustain
 * differential returns vs competitors. Without one, returns get
 * arbitraged away.
 */
export const sevenPowers: StrategicFramework = {
  id: "seven-powers",
  name: "7 Powers (Hamilton Helmer)",
  oneLiner: "Durable returns require ONE of: scale economies · network economies · counter-positioning · switching costs · branding · cornered resource · process power.",
  triggers: [
    /\b(seven\s+powers|7\s+powers|hamilton\s+helmer)\b/i,
    /\b(durable\s+(advantage|moat|edge)|sustainable\s+advantage)\b/i,
    /\b(network\s+effects?|counter[\s-]positioning)\b/i,
    /\b(switching\s+costs?|cornered\s+resource|process\s+power)\b/i,
    /\b(scale\s+economies|economies\s+of\s+scale)\b/i,
    /\b(why\s+(can't|won't)\s+(competitors?|incumbents?)\s+(copy|match|catch\s+up))/i,
    /\b(what\s+(protects|defends)\s+(this|our)\s+(business|moat))/i,
    /\b(competitive\s+moat|defensibility|barrier)\b/i,
  ],
  weight: 1.0,
  lens: `Apply the 7 Powers lens. Helmer's claim · only seven conditions
produce durable differential returns. Walk them · for each, ask:
do we have it · could we build it · does the competitor have it?

  1. SCALE ECONOMIES · cost-per-unit drops as volume grows · the
     leader can underprice the follower indefinitely. Big-box retail.

  2. NETWORK ECONOMIES · the product gets MORE valuable as more
     people use it. Marketplaces · social platforms · LinkedIn.

  3. COUNTER-POSITIONING · a new model that incumbents can't copy
     because copying would cannibalize their existing business.
     Vanguard low-fee funds vs. active managers · Netflix vs Blockbuster.

  4. SWITCHING COSTS · the customer pays a cost to leave · data ·
     workflow · habit · contracts · integrations. Salesforce · accounting
     software · CRM · the auto-shop with their service history on file.

  5. BRANDING · the same product, identical specs, sells for more
     because of trust signals. Tiffany · Patagonia · "the dealer
     said we needed it."

  6. CORNERED RESOURCE · privileged access to something rare ·
     a key patent · exclusive supplier deal · a star CEO · location.

  7. PROCESS POWER · ways of working that produce superior outcomes
     and that take YEARS for competitors to replicate. Toyota
     production system · SpaceX iteration cadence.

Without ONE of the 7 · the business converges to commodity returns.
Surface which power(s) the business has, which it could build,
and where the competitor's power is creating the squeeze.`,
};
