import type { StrategicFramework } from "../types";

/**
 * Second-Order Thinking (Howard Marks · "The Most Important Thing") ·
 * the first-order consequence is what's obvious; the second-order
 * is what comes AFTER. Most decisions are evaluated only at first
 * order, which is why most decisions are wrong in retrospect.
 */
export const secondOrderThinking: StrategicFramework = {
  id: "second-order-thinking",
  name: "Second-Order Thinking (Howard Marks)",
  oneLiner: "First-order = the obvious consequence. Second-order = what comes after. Most decisions evaluated only at first order are wrong in hindsight.",
  triggers: [
    /\bsecond[\s-]?order\s+thinking|first[\s-]?order\s+thinking\b/i,
    /\b(howard\s+marks|the\s+most\s+important\s+thing)/i,
    /\b(what\s+happens?\s+next|what\s+comes?\s+after)\b/i,
    /\b(consequences?\s+of\s+the\s+(decision|choice|action))/i,
    /\b(downstream\s+(effects?|consequences?|impacts?))/i,
    /\b(unintended\s+consequences?)\b/i,
    /\b(ripple\s+effects?|knock[\s-]on\s+effects?)/i,
    /\b(and\s+then\s+what)\b/i,
    /\b(reaction\s+(to\s+)?(the\s+)?(market|customers?|competitors?))/i,
  ],
  weight: 1.0,
  featured: true, // 2026-05-23 · Wave E · baseline lens shown in generic fallback
  lens: `Apply Second-Order Thinking. Marks's claim · "first-level thinking
says, 'It's a good company; let's buy the stock.' Second-level
thinking says, 'It's a good company, but everyone thinks it's a
great company, and it's not. So the stock is overrated and
overpriced; let's sell.'"

The general structure ·

  FIRST-ORDER  · do action X → get consequence Y
  SECOND-ORDER · do action X → consequence Y → other parties react
                 with Z → real outcome is Y+Z (often very different)

Examples ·

  · Cut prices to win customers (1st order) → competitors match
    (2nd) → industry margins compressed for years (real outcome)
  · Hire a star tech for double pay (1st order) → existing techs
    learn the new salary (2nd) → either raise everyone (real
    outcome: 2x payroll) or face attrition (real outcome: lose
    senior team)
  · Run an aggressive sale (1st order) → customers wait for the
    next sale (2nd) → price-anchored customer base expects
    discounts forever (real outcome)

The decision-relevant questions ·

  · What does this look like AFTER everyone has reacted?
  · What's the new equilibrium · not the snapshot of the moment?
  · Who else has a stake · how do they respond · then what?
  · Is this decision still right after we draw out 2-3 reaction
    rounds, or only at first order?

Most "obvious" decisions look very different at second order.
The skill is forcing yourself past the first-order frame · which
is uncomfortable because it requires admitting you can't see all
the consequences clearly.

For Nick · price moves, hiring decisions, marketing campaigns,
partnership offers · all benefit from "and then what?" repeated
until the picture stabilizes. Many obvious-good moves disappear
under second-order scrutiny; many counterintuitive ones survive.

Surface · the first-order outcome · the 2-3 reactions that follow ·
the equilibrium that results · whether the decision survives.`,
};
