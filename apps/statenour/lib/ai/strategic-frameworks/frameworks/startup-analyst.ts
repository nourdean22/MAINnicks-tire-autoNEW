import type { StrategicFramework } from "../types";

/**
 * Startup Analyst — operator-decision lens. The "should I keep doing
 * this / pivot / cut" question. Pull data, ignore feelings, decide
 * with reversibility in mind.
 */
export const startupAnalyst: StrategicFramework = {
  id: "startup-analyst",
  name: "Startup Analyst",
  oneLiner: "Data over vibes · evaluate keep/pivot/cut · know your reversible vs irreversible decisions.",
  triggers: [
    /\b(should\s+(we|i)\s+(keep|continue|stop|pivot|cut|kill|double\s+down))/i,
    /\b(pivot|kill\s+the\s+(project|product|service|line))\b/i,
    /\b(double\s+down|invest\s+more|stop\s+investing)\b/i,
    /\b(business\s+analy(sis|st|tical))\b/i,
    /\b(SWOT|opportunity\s+cost|sunk\s+cost)\b/i,
    /\b(is\s+it\s+(working|paying\s+off|worth\s+it))\b/i,
    /\b(go\s+\/\s+no[\s-]go|kill\s+criteria)\b/i,
  ],
  weight: 1.0,
  lens: `Apply the Startup Analyst lens. The right question is rarely "is it
working" — it's "is it working *enough* relative to what else this
time and capital could buy."

  1. STATE THE BAR · what's the threshold that justifies continuing?
     If the team can't articulate it, the project is on autopilot.
     "It's growing" is not a bar.

  2. SUNK COST AUDIT · ignore everything spent so far. Decide as if
     starting today. If you wouldn't start it now, the prior spend
     doesn't justify continuing.

  3. OPPORTUNITY COST · what would the same time/capital do
     elsewhere? The hidden cost of saying "let it run another quarter"
     is whatever else couldn't get attention.

  4. REVERSIBILITY · most decisions are reversible at low cost. Bias
     toward fast trials when reversible · slow + careful when not.

Recommend: keep, pivot, or cut · with the threshold and the
reversibility cost named explicitly. No "let's see how it goes" —
that's not a decision, it's avoidance.`,
};
