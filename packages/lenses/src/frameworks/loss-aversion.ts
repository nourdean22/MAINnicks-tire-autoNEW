import type { StrategicFramework } from "../types";

/**
 * Loss Aversion / Prospect Theory (Kahneman & Tversky) · people feel
 * losses ~2x as strongly as equivalent gains. Asymmetric. Drives most
 * marketing copy, pricing structures, sales-close mechanics, and
 * negotiation framing. The same offer framed as "save " vs "lose
 * " produces dramatically different responses.
 */
export const lossAversion: StrategicFramework = {
  id: "loss-aversion",
  name: "Loss Aversion (Kahneman · Prospect Theory)",
  oneLiner: "Losses feel ~2x as bad as equivalent gains feel good. Same offer · different frame · very different response. Use the asymmetry, don't fight it.",
  triggers: [
    /\bloss\s+aversion|prospect\s+theory\b/i,
    /\b(kahneman|tversky|thinking\s+fast\s+and\s+slow)/i,
    /\b(framing\s+effects?)\b/i,
    /\b(save\s+vs\s+lose|gain\s+vs\s+loss)\b/i,
    /\b(scarcity\s+(effect|frame)|FOMO)\b/i,
    /\b(missing\s+out|don't\s+miss\s+(out|this))/i,
    /\b(risk\s+aversion|risk[\s-]averse|risk[\s-]seeking)\b/i,
    /\b(why\s+do\s+(people|customers?)\s+(react|respond)\s+to\s+(price|loss))/i,
    /\b(default\s+(option|choice|effect))\b/i,
  ],
  weight: 0.95,
  lens: `Apply Loss Aversion (Prospect Theory). Kahneman & Tversky's
discovery · humans don't process gains and losses symmetrically.
A  loss feels roughly TWICE as painful as a  gain feels
good. This asymmetry shows up everywhere ·

  · The same product framed as "you save " converts WORSE
    than "without this you LOSE  per month." Same math ·
    different feeling.
  · "Free trial that auto-charges" works better than "paid trial
    with refund" because losing-something-you-have feels worse
    than not-getting-it.
  · Status-quo bias is a special case of loss aversion · changing
    the default feels like a loss · keeping it doesn't.
  · Sale endings ("only 2 days left") activate loss aversion ·
    you're about to LOSE the discount, not just miss the offer.

The decision-relevant moves ·

  1. FRAME GAINS AS LOSSES THE CUSTOMER ALREADY HAS · "You're
     leaving  on the table by skipping our maintenance plan"
     beats "Save  with our maintenance plan."
  2. ENGINEER DEFAULT-IN · once they have something, the loss
     aversion works for you · subscriptions auto-renew because
     cancelling activates the loss frame.
  3. SCARCITY + SOCIAL PROOF · "Most customers in your area chose
     the upgrade, only 3 spots left this week" combines proof
     with potential loss.
  4. WATCH FOR IT IN YOUR OWN DECISIONS · loss aversion makes
     you hold losing stocks (selling = realizing the loss),
     stick with bad hires (firing = admitting the cost), and
     keep failing experiments (killing = abandoning sunk cost).

ETHICAL EDGE · loss aversion is real and powerful · it can be
used to manipulate or to clarify. The honest test · would the
customer THANK you for the framing once they see what they got
vs paid? If yes, it's persuasion. If no, it's manipulation that
backfires when they figure it out.

For Nick · the maintenance plan, the financing offer, the
"diagnostic free with service" offer · all benefit from loss-
aversion framing done honestly. Customers respond better to the
loss-frame · they should still get good value behind the frame.

Surface · the gain-frame and the loss-frame side by side · which
is more accurate to what's actually at stake · the sequence /
default that uses the asymmetry without crossing into manipulation.`,
};
