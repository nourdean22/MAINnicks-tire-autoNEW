import type { StrategicFramework } from "../types";

/**
 * Growth Engine — for "wire the marketing into one machine." Each
 * stage is a loop: acquire → activate → retain → refer → revenue.
 * Ads are inputs; the machine is the leverage.
 */
export const growthEngine: StrategicFramework = {
  id: "growth-engine",
  name: "Growth Engine Architecture",
  oneLiner: "Acquire → activate → retain → refer → revenue · each stage is a loop · ads are inputs, the machine is the leverage.",
  triggers: [
    /\b(growth\s+engine|growth\s+loop|aarrr|pirate\s+metrics)\b/i,
    /\b(funnel|customer\s+journey)\b/i,
    /\b(re[\s-]?engagement|re[\s-]?activation|win[\s-]?back)\b/i,
    /\b(retention|churn(\s+rate)?)\b/i,
    /\b(referral\s+(loop|program|engine))\b/i,
    /\b(marketing\s+(machine|engine|system|infrastructure))\b/i,
    /\b(ads?\s+to\s+(site|crm|lead|conversion))\b/i,
    /\bnorth\s*star\s+metric\b/i,
    /\b(ltv|cac)\b/i,
  ],
  antiTriggers: [
    // physical funnel · cake / kitchen / wine-bottle / cone / paper / metal
    /\bfunnel\s+cake\b/i,
    /\b(kitchen|cooking|baking|wine|bottle|metal|plastic|paper|cone|chest)\s+funnel\b/i,
    /\bfunnel\s+of\s+(the\s+|my\s+)?(wine\s+)?bottle\b/i,
    // customer journey used in physical-travel sense
    /\bcustomer\s+journey\s+(through|across|to|down)\s+(downtown|the\s+city|the\s+town|the\s+airport|the\s+park)/i,
  ],
  weight: 1.0,
  lens: `Apply the Growth Engine model. Marketing is a SYSTEM, not a
campaign. 5 stages, each a loop:

  1. ACQUIRE   · how do strangers find you? (ads / SEO / referral / partnerships)
                Cost = CAC. Leverage = compounding inbound.
  2. ACTIVATE  · first valuable experience. (first booking / first oil change)
                Drop-off here is invisible without instrumentation.
  3. RETAIN    · the second visit. Most businesses optimize 1+2 and
                ignore 3 — that's where 80% of LTV lives.
  4. REFER     · happy customers carry word. Make it easy + worth it.
                The strongest growth loop because CAC = $0.
  5. REVENUE   · how each customer's spend grows over time. Upsell
                paths, recurring components, tier upgrades.

Ask: which stage is the WEAKEST link? That's the leverage point.
Pumping more ads (acquire) into a leaky activate stage burns cash.
Plugging the leak compounds.`,
};
