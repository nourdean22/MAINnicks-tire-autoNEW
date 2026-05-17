import type { StrategicFramework } from "../types";

/**
 * Crossing the Chasm (Geoffrey Moore) — adoption-curve strategy.
 * Early adopters and early majority buy for opposite reasons. The
 * "chasm" is the gap that kills most products that worked with
 * innovators but never made it mainstream.
 */
export const crossingTheChasm: StrategicFramework = {
  id: "crossing-the-chasm",
  name: "Crossing the Chasm (Geoffrey Moore)",
  oneLiner: "Early adopters buy on vision · early majority buy on references. Most products die in the gap. Pick a beachhead segment and dominate it.",
  triggers: [
    /\bcrossing\s+the\s+chasm|geoffrey\s+moore\b/i,
    /\b(early\s+adopters?|innovators?|laggards?|early\s+majority)\b/i,
    /\b(adoption\s+curve|adoption\s+(cycle|phase))\b/i,
    /\b(beachhead|niche\s+(market|segment)|target\s+segment)\b/i,
    /\b(why\s+(isn't|aren't)\s+(this|we)\s+(catching\s+on|going\s+mainstream|reaching\s+more\s+customers))/i,
    /\b(stuck\s+in\s+(the\s+)?(early|niche))/i,
    /\b(mainstream\s+(adoption|customers?|market))/i,
    /\b(reference\s+customers?|case\s+studies\s+for\s+selling)/i,
  ],
  weight: 0.95,
  lens: `Apply the Crossing the Chasm lens. Moore's discovery · adoption
isn't a smooth curve · there's a "chasm" between early adopters
and the early majority where most products die. The two groups
buy for opposite reasons ·

  · EARLY ADOPTERS buy on VISION · they want to be first · they
    forgive bugs · they tell their friends · they pay full price
    for the "future." They are 13.5% of any market.

  · EARLY MAJORITY buys on REFERENCES · they want proof other
    people-like-them already use it successfully · they want
    case studies, testimonials, low-risk rollout. They are 34%
    of the market and where the real money is.

The chasm is the gap between these two groups · a product that
works for adopters often has zero traction with majority because
the majority can't get the references they need.

The mainstream-crossing playbook · DON'T try to sell to everyone ·
pick a BEACHHEAD segment narrow enough that you can dominate it
fully. "Ortho dental practices in Cleveland" beats "all dentists."
Once you own the beachhead, the references are concentrated, the
word-of-mouth is loud, and you can use that segment as the
launchpad to adjacent ones.

For Nick's tire shop · the "chasm" looks like the gap between
"tire-savvy car people who already trust you" and "average
Cleveland driver who's loyal to the dealership." Different
buying motivation · different proof needed · different message.

Surface · which segment is the beachhead · what proof do mainstream
buyers need to switch · what's the adjacent segment after the
beachhead is locked.`,
};
