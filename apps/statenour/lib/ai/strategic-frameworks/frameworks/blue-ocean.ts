import type { StrategicFramework } from "../types";

/**
 * Blue Ocean Strategy (Kim & Mauborgne) — create uncontested market
 * space rather than fight in the bloody "red ocean" of existing
 * competition. Done via the Eliminate / Reduce / Raise / Create grid.
 */
export const blueOcean: StrategicFramework = {
  id: "blue-ocean",
  name: "Blue Ocean Strategy (Kim & Mauborgne)",
  oneLiner: "Stop fighting in red oceans · create uncontested space. Eliminate · reduce · raise · create · what factors does the industry compete on?",
  triggers: [
    /\b(blue\s+ocean|red\s+ocean)\b/i,
    /\b(uncontested\s+market\s+space)/i,
    /\b(eliminate\s+reduce\s+raise\s+create|err?c\s+grid)/i,
    /\b(value\s+innovation)\b/i,
    /\b(differentiation\s+(and|plus)\s+low\s+cost)/i,
    /\b(stop\s+competing|escape\s+the\s+(competition|race))/i,
    /\b(category\s+(creator|design|king))\b/i,
    /\b(kim\s+(and|&)\s+mauborgne|insead)/i,
  ],
  weight: 0.95,
  lens: `Apply Blue Ocean Strategy. The premise · most businesses fight
in a "red ocean" · same customers · same product factors · ranked
by who's slightly better at the same things. Margins compress.
Innovation in red oceans is incremental. Blue Ocean = redesign
the FACTORS the industry competes on so you're not in the same
race anymore.

The ERRC Grid · for each factor the industry takes for granted, ask:

  ELIMINATE · what does everyone in the industry do that we can
              cut entirely? (Most factors are inherited tradition,
              not customer-required.)
  REDUCE    · what does everyone over-invest in vs what customers
              actually value?
  RAISE     · what's underdelivered industry-wide that we could
              go above on?
  CREATE    · what new factor could we introduce that no one
              else has?

Tire-shop example · the dealership service department competes
on factors like "name brand" · "OEM parts" · "fancy waiting room."
A blue-ocean tire shop might · ELIMINATE the long wait (mobile or
1-hour guarantee) · REDUCE markup on parts · RAISE transparency
(show them the worn part, photo + video) · CREATE a relationship
layer (text history of every visit, a single named tech who knows
their car).

The win-condition · differentiation AND low cost simultaneously ·
because by changing the factor mix, you stop spending on factors
that don't move customers and reinvest in factors that do.

Surface · the factors of competition the industry takes for
granted · which ones can be eliminated/reduced · which ones are
the new battleground.`,
};
