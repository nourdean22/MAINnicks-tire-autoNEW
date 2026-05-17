import type { StrategicFramework } from "../types";

/**
 * Porter's Five Forces — industry structure analysis. Why is this
 * industry profitable (or not) and where does the pressure come from?
 * The strategic position you can take is bounded by the structure of
 * the game you're playing.
 */
export const portersFiveForces: StrategicFramework = {
  id: "porters-five-forces",
  name: "Porter's Five Forces (industry structure)",
  oneLiner: "Industry profitability is set by 5 forces · supplier power · buyer power · threat of new entrants · threat of substitutes · rivalry. Pick the position that minimizes the squeeze.",
  triggers: [
    /\b(industry\s+(structure|attractiveness|analysis|dynamics))\b/i,
    /\b(porter|five\s+forces|5\s+forces)\b/i,
    /\b(supplier\s+power|buyer\s+power|bargaining\s+power)\b/i,
    /\b(barriers?\s+to\s+entry|new\s+entrants?)\b/i,
    /\b(threat\s+of\s+(substitutes?|new\s+entrants?))\b/i,
    /\b(rivalry|competitive\s+intensity|price\s+war)\b/i,
    /\b(why\s+(is|are)\s+(margins?|profits?)\s+(low|thin|compressed))\b/i,
    /\b(commoditiz|race\s+to\s+the\s+bottom)\b/i,
  ],
  weight: 1.0,
  lens: `Apply Porter's Five Forces. Industry profitability is structural ·
not the result of who tries hardest. Walk the 5 forces and grade
each as LOW / MEDIUM / HIGH pressure on margins:

  1. SUPPLIER POWER · how many alternatives exist · is the input
     unique · can suppliers integrate forward? Tire shops · 2-3
     dominant tire makers (Michelin · Goodyear · Bridgestone) hold
     real power; oil + lift + diagnostic-tool suppliers don't.

  2. BUYER POWER · is the customer concentrated · do they have
     transparency on pricing · do they have alternatives? Retail
     drivers individually weak; fleet contracts strong.

  3. THREAT OF NEW ENTRANTS · how hard is it to start a competing
     shop in 12 months · what protects you (location · brand ·
     equipment cost · regulation · permits · staff)? If a teenager
     could open shop next door, the moat is thin.

  4. THREAT OF SUBSTITUTES · what does the customer do INSTEAD ·
     mobile mechanics · DIY · dealership service · fleet self-
     service · waiting longer between services?

  5. RIVALRY · how many shops within 5 miles · do they all do the
     same thing · is anyone undercutting? High rivalry compresses
     pricing toward marginal cost.

The position you take in the industry is constrained by these
forces · don't fight the structure · either pick a corner where
the squeeze is lowest, or change the structure (vertical integrate,
build switching costs, change the unit of competition).

Surface the 1-2 forces squeezing margins HARDEST · the strategic
move usually attacks one of those.`,
};
