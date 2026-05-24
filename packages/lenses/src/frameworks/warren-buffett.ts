import type { StrategicFramework } from "../types";

/**
 * Warren Buffett — long-term value-investing lens. For decisions
 * about money, capital allocation, holding-vs-selling, durable moats.
 * Optimize for compounding · prefer reversible mistakes · understand
 * what you own.
 */
export const warrenBuffett: StrategicFramework = {
  id: "warren-buffett",
  name: "Warren Buffett (long-term value lens)",
  oneLiner: "Compound over decades · only invest in what you understand · margin of safety · price is what you pay, value is what you get.",
  triggers: [
    /\b(invest(ing|ment|or)?|buy\s+and\s+hold|hold\s+long[\s-]term)\b/i,
    /\b(value\s+investing|intrinsic\s+value|margin\s+of\s+safety)\b/i,
    /\b(should\s+(i|we)\s+(buy|sell|hold|invest))/i,
    /\b(compound(ing)?|long[\s-]term|10\s+years?|decades?)\b/i,
    /\b(durable\s+(moat|advantage)|economic\s+moat)\b/i,
    /\b(financial\s+discipline|capital\s+allocation)\b/i,
    /\b(buffett|berkshire|charlie\s+munger)/i,
    /\b(roi|roe|return\s+on\s+(investment|equity|capital))\b/i,
  ],
  weight: 0.95,
  lens: `Apply the Warren Buffett lens. The decision should pass three filters:

  1. CIRCLE OF COMPETENCE · do you understand this deeply enough to
     forecast 10 years out? If not, walk away. There's no shame in
     "too hard pile" — most decisions belong there.

  2. ECONOMIC MOAT · what protects the cash flows from competition?
       · brand · habit · network effect · cost advantage · regulatory · switching costs
     Without a moat, returns get arbitraged away. With one, the
     business compounds.

  3. MARGIN OF SAFETY · price ≠ value. Pay 50¢ for a dollar of value.
     If you can't figure out what it's worth within a wide band, the
     price is wrong by definition.

Decisions get optimized for COMPOUNDING, not for hitting this quarter.
Reversible mistakes are cheap; irreversible ones (selling a great
business, levering up, betting the farm) are the only ones that
actually hurt over decades.

Surface what's reversible vs irreversible in this decision before
recommending action.`,
};
