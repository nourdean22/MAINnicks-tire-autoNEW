import type { StrategicFramework } from "../types";

/**
 * The High End (Greene, Mastery Book V) — granular work without a visible
 * highest purpose becomes motion that feels like diligence. The purpose
 * is what selects which details deserve the day.
 */
export const theHighEnd: StrategicFramework = {
  id: "the-high-end",
  name: "The High End (Greene · Mastery)",
  oneLiner: "Detail without a visible purpose is motion. Keep the high end in view and let it decide which details earn the day.",
  triggers: [
    /\b(in\s+the\s+weeds|rabbit\s+hole|bikeshed(ding)?)\b/i,
    /\b(lost|losing)\s+(sight|track)\s+of\s+(the\s+)?(big\s+picture|goal|point)\b/i,
    /\b(does\s+this\s+even\s+matter|is\s+this\s+(even\s+)?worth\s+it)\b/i,
    /\b(spent|spending)\s+(all\s+)?(day|week|hours)\s+on\b/i,
    /\b(why\s+am\s+i\s+doing\s+this)\b/i,
    /\b(polish(ing)?|perfecting|gold.?plating)\b/i,
  ],
  antiTriggers: [
    // "high end" as a market/pricing tier, not Greene's sense.
    /\b(high.?end)\s+(customers?|clients?|market|segment|pricing|tier|brand|detailing)\b/i,
  ],
  weight: 0.9,
  lens: `Apply The High End. Low-end work is always available and always
supplies the sensation of progress, which is what makes this the most
comfortable failure mode there is. Require a one-step trace from the
current task to the stated objective — if explaining the connection takes
two steps, it is low-end work wearing a disguise. Re-anchor before
selecting the next task rather than after the day is spent, and compare
hours spent on polish against hours on the one thing that compounds.
Where the detail work is genuinely necessary, timebox it instead of
assuming it will be resisted.`,
};
