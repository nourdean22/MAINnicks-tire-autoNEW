import type { StrategicFramework } from "../types";

/**
 * Business Model Canvas (Osterwalder) — for "how does this business
 * make money / deliver value end-to-end". 9 building blocks that
 * map the whole machine.
 */
export const osterwalderCanvas: StrategicFramework = {
  id: "osterwalder-canvas",
  name: "Business Model Canvas",
  oneLiner: "Maps how a business creates, delivers, and captures value across 9 building blocks.",
  triggers: [
    /\bbusiness\s+model\b/i,
    /\bvalue\s+prop(osition|ositions?)?\b/i,
    /\b(key\s+(activities|partners|resources))\b/i,
    /\bcost\s+structure\b/i,
    /\brevenue\s+streams?\b/i,
    /\bcustomer\s+segments?\b/i,
    /\b(channels?|distribution)\b/i,
    /\bcustomer\s+relationships?\b/i,
    /\bcanvas\b/i,
    // catch "value proposition[s] [we're] delivering to [fleet] customers"
    /\bvalu(e|es)\s+(we|i|the\s+(shop|business))\s+(deliver|provide|offer)/i,
    /\bhow\s+(does|do|should)\s+(this|the|my|we)\s+(business|company|shop|service|product)\s+(make|deliver|capture|generate)\s+(money|value|revenue)/i,
  ],
  weight: 1.1,
  lens: `Apply the Business Model Canvas (Osterwalder). Reason through the
9 building blocks that fit the question:
  1. Customer segments — who exactly?
  2. Value propositions — what real problem does each segment have?
  3. Channels — how does value reach them?
  4. Customer relationships — transactional / personal / community?
  5. Revenue streams — per-unit / subscription / licensing / referral?
  6. Key resources — physical / IP / human / capital
  7. Key activities — what MUST the business do well?
  8. Key partners — who do we lean on so we don't have to do it ourselves?
  9. Cost structure — what's fixed, what scales linearly, what scales superlinearly?
Pick 2-3 blocks that move the needle on this question and go deep. Don't
list all 9 in the answer — surface the ones that change the decision.`,
};
