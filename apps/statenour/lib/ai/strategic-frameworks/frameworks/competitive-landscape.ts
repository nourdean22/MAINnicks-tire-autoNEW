import type { StrategicFramework } from "../types";

/**
 * Competitive Landscape — for "where do we play / who's strong /
 * where's the gap." Map the field, find the differentiation source,
 * pick a position you can defend.
 */
export const competitiveLandscape: StrategicFramework = {
  id: "competitive-landscape",
  name: "Competitive Landscape Mapping",
  oneLiner: "Map who's strong, who's weak, where the gap is — pick a position you can defend.",
  triggers: [
    /\b(competitors?|competition|competitive|competing)\b/i,
    /\b(market\s+(position|share|map|landscape))\b/i,
    /\bdifferentiat(ion|ed|or)\b/i,
    /\b(why\s+(would|should)\s+(customers?|they|someone)\s+(choose|pick)\s+us)/i,
    /\b(versus|vs\.?)\s+(\w+\s+){0,5}competitors?/i,
    /\b(unique\s+(selling|advantage|edge|position))\b/i,
    /\bmoat\b/i,
    /\b(positioning|positioned)\b/i,
    /\bwhere\s+are\s+we\s+positioned\b/i,
    /\bvs\.?\s+(other\s+)?(cleveland\s+)?(shops?|competitors?|stores?)/i,
  ],
  weight: 1.0,
  lens: `Apply Competitive Landscape Mapping. Reason in 3 layers:

  1. MAP THE FIELD · who plays here? Group competitors by what they
     compete on:
       · Speed (fastest turnaround)
       · Price (cheapest)
       · Trust (best reputation, longest-running)
       · Convenience (closest, easiest)
       · Specialty (deepest expertise in a niche)

  2. FIND THE GAP · where is no one playing? Or where is everyone
     playing the same way (commoditized)? The opportunity is the
     intersection: a real customer need + a slot no competitor owns.

  3. PICK YOUR POSITION · you can only credibly own ONE primary
     dimension. Two-dimension claims ("fastest AND cheapest") trigger
     immediate skepticism. Pick the strongest, signal it consistently.

Don't list every competitor — name 2-3 archetypes and where you fit
relative to them. The output should change Nour's next decision (ad
copy, hire, service tier), not just describe the market.`,
};
