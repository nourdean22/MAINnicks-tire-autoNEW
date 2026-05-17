import type { StrategicFramework } from "../types";

/**
 * Innovator's Dilemma (Clayton Christensen) — disruption theory.
 * Why do well-run incumbents lose to "worse" new entrants? Because
 * sustaining innovation rewards the existing customer base; disruptive
 * innovation serves a NEW customer who doesn't yet exist on the
 * incumbent's roadmap.
 */
export const innovatorsDilemma: StrategicFramework = {
  id: "innovators-dilemma",
  name: "Innovator's Dilemma (Clayton Christensen)",
  oneLiner: "Incumbents lose to 'worse' new entrants because sustaining innovation serves existing customers, while disruption serves a non-customer the incumbent ignores.",
  triggers: [
    /\b(innovator['s]?\s+dilemma|christensen|disruption\s+theory)\b/i,
    /\b(disruptive\s+(innovation|technology|player))\b/i,
    /\b(sustaining\s+innovation)/i,
    /\b(low[\s-]end\s+(disruption|entrant))\b/i,
    /\b(jobs[\s-]?to[\s-]?be[\s-]?done\s+disruption)/i,
    /\b(why\s+do\s+(incumbents?|big\s+companies)\s+(lose|miss|fail))/i,
    /\b(non[\s-]consumers?|non[\s-]customers?|new[\s-]market)/i,
  ],
  weight: 1.0,
  lens: `Apply the Innovator's Dilemma. Christensen's discovery · large
incumbents are RATIONAL when they ignore disruptive entrants ·
the entrant's product is genuinely worse on the metrics existing
customers care about, AND the entrant's segment is too small to
move the incumbent's needle. So the incumbent stays focused on
the high-end customer · meanwhile the entrant improves until it's
"good enough" for the mainstream · and then it eats the entire
market from below.

Two flavors of disruption ·

  1. LOW-END DISRUPTION · entrant targets the incumbent's least-
     profitable customers with a stripped-down, cheaper product.
     Incumbent is happy to lose them. Entrant climbs the ladder.
     Example · Hyundai vs Toyota in the 80s · Toyota vs GM in the
     70s. Discount tire chains vs. dealer service departments.

  2. NEW-MARKET DISRUPTION · entrant serves people who weren't
     buying anything before. Doesn't compete with the incumbent
     directly until the new market overlaps with the old.
     Example · personal computers vs minicomputers · YouTube vs
     network TV.

For Nick's tire shop · the incumbent is the dealership service
department; the disruptors are mobile mechanics, BoxBox-style
quick-service, EV-only specialists. Watch for the segment that's
"too small to matter" today · that's where the next decade's
threat is being incubated.

Surface · who's being underserved by the current market · what
"worse" product would look "good enough" to them · whether you
want to be the disruptor or the incumbent on this question.`,
};
