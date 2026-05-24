import type { StrategicFramework } from "../types";

/**
 * Jobs To Be Done — for "why customers REALLY buy". Customers don't
 * buy products, they hire them to do a job. Beats surface-level
 * "they need X" reasoning by surfacing the functional + emotional +
 * social dimensions.
 */
export const jobsToBeDone: StrategicFramework = {
  id: "jobs-to-be-done",
  name: "Jobs To Be Done (JTBD)",
  oneLiner: "Customers hire products to do a job — functional, emotional, and social.",
  triggers: [
    /\b(why\s+(do|would|did)\s+(customers?|people|they)\s+(buy|hire|come|come\s+back|return|choose|really\s+(buy|come|hire)))/i,
    /\b(why\s+do\s+customers?\s+really)/i,
    /\bjob[s]?\s+to\s+be\s+done\b/i,
    /\bjtbd\b/i,
    /\b(what\s+(are\s+they|is\s+the\s+customer|customers?)\s+(really|actually)\s+(buying|hiring|paying\s+for))/i,
    /\bunderlying\s+(motivation|need)\b/i,
    /\bcustomer\s+motivation\b/i,
    /\b(emotional|functional|social)\s+(job|need|driver)\b/i,
  ],
  weight: 1.05,
  featured: true, // 2026-05-23 · Wave E · baseline lens shown in generic fallback
  lens: `Apply Jobs To Be Done. Customers don't buy a product — they hire it
to do a job. Map the THREE dimensions:
  · Functional · the visible task ("get the brakes fixed")
  · Emotional  · how the customer wants to feel ("safe driving the kids",
    "respected by the mechanic", "in control of car decisions")
  · Social     · how they want to be seen ("the kind of person who
    handles maintenance proactively")
Then ask: what would the customer FIRE this product/shop FOR if a
better option appeared? That tells you the real moat. Don't stop at
"they need brakes" — the brakes are the means; the job is the end.`,
};
