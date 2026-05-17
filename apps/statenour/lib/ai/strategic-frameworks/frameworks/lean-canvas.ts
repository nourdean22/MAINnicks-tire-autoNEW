import type { StrategicFramework } from "../types";

/**
 * Lean Canvas (Ash Maurya) — startup-focused 1-page business model.
 * Different from Osterwalder's Business Model Canvas · replaces
 * partners/activities/resources with problem/solution/key-metrics/
 * unfair-advantage. Built for the early stage where assumptions
 * dominate facts.
 */
export const leanCanvas: StrategicFramework = {
  id: "lean-canvas",
  name: "Lean Canvas (Ash Maurya)",
  oneLiner: "Startup-stage 1-page model · problem · solution · UVP · channels · customer segment · key metrics · cost structure · revenue streams · unfair advantage.",
  triggers: [
    /\b(lean\s+canvas|ash\s+maurya|lean\s+startup)\b/i,
    /\b(problem[\s-]solution\s+fit|product[\s-]market\s+fit)\b/i,
    /\b(unfair\s+advantage|defensibility)\b/i,
    /\b(early[\s-]stage\s+(startup|business|venture))/i,
    /\b(mvp|minimum\s+viable\s+product)\b/i,
    /\b(customer\s+(discovery|development)|problem\s+interview)/i,
    /\b(unique\s+value\s+(prop|proposition))/i,
    /\b(validate\s+(the\s+)?(problem|hypothesis|assumptions))/i,
  ],
  weight: 1.0,
  lens: `Apply the Lean Canvas. Built for early-stage situations where
the BIGGEST risks are assumption-risks · the customer might not
exist · the problem might not be real · the solution might not work.
Walk the 9 boxes:

  1. PROBLEM · the top 3 problems the customer has. Be specific ·
     "saving time" is not a problem. "Tire pressure light came on
     2 weeks ago and I don't know if it's safe to drive" is.
  2. CUSTOMER SEGMENT · who exactly · including early adopters who
     are most desperate for the solution.
  3. UNIQUE VALUE PROPOSITION · the single clear message of why
     you · why now. Should be quotable in one sentence.
  4. SOLUTION · the simplest thing that solves problem #1.
  5. CHANNELS · how you reach the customer (free + paid).
  6. REVENUE STREAMS · how you make money + the unit price.
  7. COST STRUCTURE · what it costs to deliver.
  8. KEY METRICS · the 1-3 numbers that prove it's working.
  9. UNFAIR ADVANTAGE · what can't be easily copied or bought.
     This box is usually the weakest · most early ventures don't
     have one yet · the goal is to know what you're building toward.

The Lean Canvas is meant to be CHANGED · early ventures cycle
through 5-20 versions before finding fit. Treat it as a hypothesis
log not a plan. The fastest way to be wrong is to commit to v1
without testing the problem.

Surface · which 1-2 assumptions are riskiest · what's the cheapest
test that would invalidate them.`,
};
