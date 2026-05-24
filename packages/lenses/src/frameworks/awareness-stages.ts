import type { StrategicFramework } from "../types";

/**
 * Awareness Stage Mapping — for funnel design. Eugene Schwartz's
 * 5 stages of customer awareness. Different copy / channel / offer
 * per stage. A cold Cleveland driver hearing about alignment for the
 * first time needs a wildly different message than a returning customer.
 */
export const awarenessStages: StrategicFramework = {
  id: "awareness-stages",
  name: "Awareness Stage Mapping",
  oneLiner: "5 stages: unaware → problem → solution → product → most-aware. Different copy/channel/offer per stage.",
  triggers: [
    /\b(awareness\s+stage|awareness[\s-]?level)\b/i,
    /\b(cold|warm|hot)\s+(lead|traffic|audience|prospect)\b/i,
    /\b(top\s+of\s+funnel|tofu|mofu|bofu|bottom\s+of\s+funnel)\b/i,
    /\b(unaware|problem[\s-]?aware|solution[\s-]?aware|product[\s-]?aware|most[\s-]?aware)\b/i,
    /\b(retargeting|remarketing)\b/i,
    /\bad\s+funnel\b/i,
    /\b(consideration|decision)\s+stage\b/i,
  ],
  weight: 1.0,
  lens: `Apply Eugene Schwartz's Awareness Stage Mapping. The CUSTOMER's
mental state determines what message lands:

  1. UNAWARE          · doesn't know they have a problem. Lead with
                        identity / story / disruption — never with the offer.
  2. PROBLEM-AWARE    · knows the symptom, not the cause. Lead with
                        diagnosis + amplification of consequence.
  3. SOLUTION-AWARE   · knows fixes exist, not yours. Lead with
                        contrast vs alternatives + your differentiator.
  4. PRODUCT-AWARE    · knows you exist, hasn't bought. Lead with
                        proof, urgency, friction-removers.
  5. MOST-AWARE       · ready to buy on the right offer. Lead with
                        the offer + scarcity. Don't re-sell the why.

A cold Cleveland driver scrolling Facebook is at stage 1-2. A returning
customer driving past the shop is at stage 4-5. Same offer, different
message — or you waste the impression.`,
};
