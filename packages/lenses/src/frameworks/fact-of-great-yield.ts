import type { StrategicFramework } from "../types";

/**
 * The Fact of Great Yield (Greene, Mastery Book V) — Darwin's method:
 * the observation that refuses to fit the theory is worth more than a
 * hundred that confirm it, and is the one everyone averts their eyes from.
 */
export const factOfGreatYield: StrategicFramework = {
  id: "fact-of-great-yield",
  name: "The Fact of Great Yield (Greene · Mastery)",
  oneLiner: "Chase the result that breaks your model. Confirming data restates what you believe; the anomaly tells you what is true.",
  triggers: [
    /\b(doesn'?t|does\s+not)\s+(add\s+up|make\s+sense|fit|match)\b/i,
    /\b(weird|strange|odd|unexpected|surprising)\s+(result|number|outlier|spike|drop|pattern)\b/i,
    /\b(outlier|anomal(y|ies|ous))\b/i,
    /\b(can'?t|cannot)\s+explain\b/i,
    /\b(contradicts?|contradict(ing|ory))\b/i,
    /\b(shouldn'?t|should\s+not)\s+be\s+(happening|possible)\b/i,
    /\b(numbers?|data|metrics?)\s+(don'?t|do\s+not)\s+match\b/i,
  ],
  weight: 0.95,
  lens: `Apply The Fact of Great Yield. Treat the inconvenient result as
the asset, not the noise — an anomaly is an accusation against a frame
someone has invested in, which is exactly why it gets explained away.
Force the explanation into the open: state the reason you are tempted to
give ("they were just price shopping", "that month was weird"), then
require evidence for it rather than accepting it as a closing argument.
Prefer one direct source over more aggregate data, because the aggregate
already agrees with the model. If the surprising case has no logged root
cause, that is an open investigation, not a settled one.`,
};
