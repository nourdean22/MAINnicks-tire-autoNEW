import type { StrategicFramework } from "../types";

/**
 * Pricing Power (Buffett's "test of a great business") — distinct from
 * pricing-strategy which is about tactics. This lens is about DURABLE
 * pricing power · the ability to raise prices without losing customers.
 * The single best diagnostic of a moat.
 */
export const pricingPower: StrategicFramework = {
  id: "pricing-power",
  name: "Pricing Power (Buffett's moat test)",
  oneLiner: "Can you raise prices 10% without losing customers? If yes, you have a real moat. If no, you have a commodity wrapped in branding.",
  triggers: [
    /\bpricing\s+power\b/i,
    /\b(can\s+(we|i|you)\s+raise\s+prices?)/i,
    /\b(raise\s+prices?\s+without\s+(losing|customer))/i,
    /\b(price\s+(elasticity|inelastic))\b/i,
    /\b(pricing\s+leverage|premium\s+pricing|charge\s+more)\b/i,
    /\b(price\s+sensitivity|price[\s-]sensitive)\b/i,
    /\b(pass\s+(through\s+)?(cost|inflation)\s+to\s+customers?)/i,
    /\b(buffett\s+pricing|moat\s+test)/i,
  ],
  weight: 1.0,
  lens: `Apply the Pricing Power lens. Buffett's claim · "the single most
important decision in evaluating a business is pricing power. If
you've got the power to raise prices without losing business to
a competitor, you've got a very good business. And if you have
to have a prayer session before raising the price by 10 percent,
then you've got a terrible business."

The diagnostic question · could you raise prices 10% across the
board tomorrow morning? Outcomes ·

  · CUSTOMERS COMPLAIN BUT PAY · you have pricing power · the moat
    is real · the brand / habit / switching cost is doing the work.
    Raise prices · margin compounds · competitors can't follow
    without losing their differentiation.

  · CUSTOMERS PROTEST AND LEAVE · you don't have pricing power ·
    you're commodity-priced · raising prices is suicide · your
    business is much weaker than it looks. The moat is mostly story.

  · YOU DON'T KNOW WHICH WILL HAPPEN · run the test on a small
    cohort. Either you find out you have pricing power (and roll
    it out), or you find out you don't (and the strategic move
    becomes "build pricing power" not "raise prices").

What CREATES pricing power ·
  · BRAND · the customer associates you with quality / safety / status
  · HABIT · they buy without thinking · switching feels like work
  · NETWORK EFFECT · leaving costs them their network
  · SWITCHING COSTS · their data / workflow / integrations are with you
  · UNIQUE VALUE · what you do is genuinely hard to replicate
  · DEMAND > SUPPLY · the customer can't easily go elsewhere

For Nick · pricing power for the tire shop comes from trust + the
specific tech who knows the customer's car + the speed of service ·
NOT from "we have tires" (every shop has tires). The pricing-power
test isn't about charging more for tires · it's about charging more
for the relationship and the convenience.

Surface · do you have pricing power · what's creating it · what
test would prove it · what's the move if you do AND what's the
move if you don't.`,
};
