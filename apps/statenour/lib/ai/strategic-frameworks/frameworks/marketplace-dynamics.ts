import type { StrategicFramework } from "../types";

/**
 * Marketplace Dynamics — chicken-and-egg supply/demand balance for
 * two-sided markets. Both sides need each other to show up · the
 * marketplace dies if one side outgrows the other or arrives first
 * with no counterparty.
 */
export const marketplaceDynamics: StrategicFramework = {
  id: "marketplace-dynamics",
  name: "Marketplace Dynamics (two-sided platforms)",
  oneLiner: "Supply + demand must arrive together · solve the chicken-and-egg by subsidizing the harder side · liquidity beats density.",
  triggers: [
    /\b(two[\s-]sided\s+(market|platform|network))/i,
    /\b(marketplace\s+(dynamics?|liquidity|chicken[\s-]and[\s-]egg))/i,
    /\b(network\s+effects?\s+(at\s+(scale|launch))?)/i,
    /\b(supply\s+(and|&)\s+demand\s+(side|balance))/i,
    /\b(cold[\s-]start\s+problem|launch\s+(a|the)\s+marketplace)/i,
    /\b(buyers?\s+and\s+sellers?|sellers?\s+and\s+buyers?)/i,
    /\b(uber|airbnb|etsy|stripe\s+marketplace|two[\s-]sided)\b/i,
    /\b(critical\s+mass|liquidity\s+threshold)/i,
  ],
  antiTriggers: [
    // 'uber' as ride-share verb · not the platform-as-business reference
    /\b(hire|take|call|order|grab|book|catch)\s+(an?\s+)?uber\b/i,
    /\b(my|the)\s+uber\s+(driver|ride|trip|is)\b/i,
  ],
  weight: 1.0,
  lens: `Apply Marketplace Dynamics. Two-sided markets fail differently
than products · they fail if EITHER side doesn't show up. Solving
the chicken-and-egg is the core problem.

Three core dynamics ·

  1. ASYMMETRIC SIDES · one side is usually harder to recruit and
     more valuable. Drivers > riders for Uber at launch. Hosts >
     guests for Airbnb. Solve the harder side first · usually
     by subsidizing it (free posting · take rate of 0% · cash
     incentives). The easier side comes after.

  2. LIQUIDITY > DENSITY · density (lots of users) is vanity ·
     liquidity (high probability that any given request finds a
     match within minutes/hours) is what makes the marketplace
     usable. A marketplace with 10 buyers + 10 sellers in one
     city is more valuable than 1000 buyers + 1000 sellers
     spread across 50 cities. Pick a tight first market and own it.

  3. SAME-SIDE vs CROSS-SIDE NETWORK EFFECTS · cross-side is good
     (more buyers attract more sellers and vice versa). Same-side
     is usually NEGATIVE (more sellers compete with each other for
     the same buyers, so each individual seller does worse with
     scale). Strong marketplaces have strong cross-side effects.

  4. MULTI-HOMING · do users use just ONE marketplace, or ALL of
     them? Uber drivers + Lyft drivers · same person, both apps.
     If multi-homing is easy on both sides, the marketplace has
     no defensive moat · differentiation must come from elsewhere.

Common failure modes ·
  · Subsidizing both sides simultaneously (burns cash without
    creating habit on either side)
  · Going wide before going deep (lots of cities, no liquidity in any)
  · Ignoring same-side dynamics (sellers fleeing as new sellers join)
  · Letting the take-rate exceed the value-add the platform creates

For Nick · the "marketplace" framing applies to the relationship
between his shop and customers + suppliers + technicians. Not a
classical marketplace, but the dynamics of "both sides must show
up" still apply to recruiting techs + retaining customer flow.

Surface · which side is harder to recruit · what's the cheapest
way to seed it · what's the liquidity threshold · multi-homing risk.`,
};
