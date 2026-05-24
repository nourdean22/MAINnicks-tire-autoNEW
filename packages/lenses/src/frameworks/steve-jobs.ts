import type { StrategicFramework } from "../types";

/**
 * Steve Jobs — product + positioning lens. Strip until what's left is
 * undeniable. Say no to 100 things to say yes to one. The product IS
 * the marketing.
 */
export const steveJobs: StrategicFramework = {
  id: "steve-jobs",
  name: "Steve Jobs (product + positioning lens)",
  oneLiner: "Say no to 100 things · ship what's undeniable · the product is the marketing · craft is the differentiator.",
  triggers: [
    /\b(product\s+(design|positioning|strategy|launch))\b/i,
    /\b(positioning|positioned)\b/i,
    /\b(simplify|simplification|strip(\s+down)?|what\s+to\s+cut)\b/i,
    /\b(MVP|minimum\s+viable|version\s+1|v1\b)/i,
    /\b(craft|polish|attention\s+to\s+detail)\b/i,
    /\b(jobs|apple|design[\s-]first)/i,
    /\b(say\s+no\s+to|focus\s+on\s+(one|the)\s+thing)/i,
    /\b(differentiat(e|ion))\b/i,
  ],
  antiTriggers: [
    /\b(steve\s+jobs?\s+(book|biography|movie|quote|said))\b/i, // factual lookup, not lens application
    /\bjob\s+to\s+be\s+done\b/i, // overlap with JTBD framework, defer to that
    /\bjobs?\s+(needed|posting|listings?|board|opening|application|search)/i, // hiring/job-search, not lens
  ],
  weight: 0.95,
  lens: `Apply the Steve Jobs lens. Product = positioning = marketing · they're
the same loop. Three rules:

  1. SAY NO TO 100 THINGS · the product gets defined by what it
     refuses to be. If everything's a feature, nothing is. Ask: what
     are we cutting BEFORE we ask what we're adding?

  2. SHIP WHAT'S UNDENIABLE · "good enough" is the killer. Either it
     makes the customer's eyes light up or it doesn't ship. The bar
     isn't "did we hit the spec," it's "would we be proud to put our
     name on this in 5 years."

  3. THE PRODUCT IS THE MARKETING · word of mouth = product quality
     × wow moment × frequency. If the wow moment is weak, no amount
     of marketing fixes it. If the wow moment is strong, marketing
     becomes amplification, not persuasion.

Apply to any positioning / launch / pricing / product decision: what
ONE thing are we trying to be undeniably the best at? Then strip
everything that doesn't serve that.`,
};
