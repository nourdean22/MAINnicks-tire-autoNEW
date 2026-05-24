import type { StrategicFramework } from "../types";

/**
 * Monetization Models — for "how should this thing charge."
 * Per-unit, subscription, retainer, success-fee, freemium, marketplace
 * take. Recurring beats one-shot for stability. Anchor pricing to
 * VALUE delivered, not cost incurred.
 */
export const monetization: StrategicFramework = {
  id: "monetization",
  name: "Monetization Model Design",
  oneLiner: "Per-unit / subscription / retainer / success-fee / freemium / marketplace — pick the structure that aligns incentives.",
  triggers: [
    /\b(monetize|monetization|monetisation)\b/i,
    /\b(revenue\s+model|business\s+model)\b/i,
    /\b(subscription|recurring(\s+revenue)?|saas)\b/i,
    /\b(retainer|service\s+fee|success\s+fee|performance\s+fee)\b/i,
    /\b(freemium|paywall|tier(s|ed)?)\b/i,
    /\b(marketplace\s+(take|fee|cut))\b/i,
    /\bhow\s+(do|should)\s+(we|i|nick'?s)\s+(charge|monetize|make\s+money)\b/i,
  ],
  weight: 1.0,
  lens: `Apply Monetization Model design. The structure of how you charge
shapes what the business becomes. Walk through the candidates:
  · Per-unit / per-transaction · simple, scales with volume, no
    revenue floor. Good for low-frequency, high-trust purchases.
  · Subscription / membership  · recurring revenue, high LTV,
    requires ongoing value delivery. Powerful when usage is steady.
  · Retainer · committed monthly/quarterly with reserved capacity.
    Good when service depth varies turn-to-turn.
  · Success-fee / performance · aligns incentives perfectly, hard to
    structure for service businesses. Works when outcome is measurable.
  · Freemium / tiered · tiers create a price-sensitivity ladder.
    The decoy tier (mid) often makes the top tier look obvious.
  · Marketplace take · only works at scale + when you control the demand side.
Then anchor pricing to VALUE delivered, not cost incurred. If you
saved a customer \$1,200 in repairs, charging \$300 is a 4x ROI for
them — they'll pay it.`,
};
