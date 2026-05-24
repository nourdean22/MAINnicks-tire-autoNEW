import type { StrategicFramework } from "../types";

/**
 * Ideal Customer Profile (ICP) — a sharp, specific definition of
 * the customer who gets the most value AND is most economical to
 * acquire / retain. The opposite of "everyone needs this" · the
 * sharpest answer is "this specific person, in this specific
 * situation, with this specific trigger."
 */
export const idealCustomerProfile: StrategicFramework = {
  id: "ideal-customer-profile",
  name: "Ideal Customer Profile (ICP)",
  oneLiner: "The 1-2 customer types where value-delivered is highest AND cost-to-acquire is lowest. Sharp ICP > broad market.",
  triggers: [
    /\b(ideal\s+customer\s+(profile|segment|avatar)|ICP)\b/i,
    /\b(target\s+customer|customer\s+avatar|customer\s+persona)\b/i,
    /\b(who\s+(is|are)\s+(your|our)\s+(best|ideal|target)\s+customers?)/i,
    /\b(buyer\s+persona)/i,
    /\b(qualify(ing)?\s+(leads?|customers?|prospects?))/i,
    /\b(disqualify|wrong\s+fit|not\s+(our|the)\s+customer)/i,
    /\b(fit\s+(score|criteria|signals?))/i,
  ],
  weight: 1.0,
  lens: `Apply Ideal Customer Profile (ICP). The premise · most businesses
say they "serve everyone who needs X." That's a positioning failure.
The truth · there's a NARROW set of customers where ·

  · the value-delivered is highest (they need exactly what you do)
  · the cost-to-acquire is lowest (they're easy to find + qualify)
  · the cost-to-serve is lowest (they fit your operations cleanly)
  · the LTV is highest (they stay, refer, expand)

Define the ICP with at least 5 dimensions ·

  1. WHO · industry · role · company-size · life-stage · psychographic
  2. SITUATION · what just happened that made them need this NOW?
  3. PAIN · the specific pain · in their words · with severity (1-10)
  4. ALTERNATIVES · what they currently use / would use instead
  5. BUDGET · what they actually have to spend · who signs the check
  6. SUCCESS METRIC · how they'll measure whether your thing worked

The disqualifying questions are equally important · who is NOT
the ICP? Who comes through the door looking right but turns out
to be high-touch, low-margin, or churning fast? Most businesses
spend 80% of their effort on customers in the bottom 20% of LTV.
Sharpening the ICP fixes that.

For Nick · the ICP for the tire shop is probably NOT "any car
owner in Cleveland." It might be "30-50 year old commuter with
a 3-10 year old daily driver, lives within 8 miles, values
honesty over price, drove past once before, has Google reviews
turned on." That's different from "deal-hunter shopping discount
chains" · same product, different ICP, completely different
acquisition strategy.

The 1-page ICP doc gets used everywhere · ad targeting · landing
copy · sales qualifying · operations scripting · which complaints
to listen to · which leads to walk away from.

Surface · the 1-2 sharpest ICPs · the disqualifying signals · what
changes about ad copy / pricing / process if we lock to this ICP.`,
};
