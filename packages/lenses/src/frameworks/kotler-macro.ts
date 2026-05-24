import type { StrategicFramework } from "../types";

/**
 * Kotler Macro Analyzer — PESTEL + Porter's Five Forces. For
 * big-picture risk + opportunity questions: 5-year horizon, EV impact,
 * regulatory shifts, structural industry change.
 */
export const kotlerMacro: StrategicFramework = {
  id: "kotler-macro",
  name: "Kotler Macro Analyzer (PESTEL + Five Forces)",
  oneLiner: "PESTEL macro forces + Porter's Five Forces — for 5-year-horizon risk + opportunity questions.",
  triggers: [
    /\b(pestel|pestle)\b/i,
    /\b(porter'?s?\s+five\s+forces|five\s+forces)\b/i,
    /\b(macro|macroeconomic|industry\s+(structure|trends?))\b/i,
    /\b(regulat(ion|ory)|compliance)\b/i,
    /\b(EV|electric\s+vehicle)s?\b/i,
    /\b(industry\s+disruption|structural\s+(change|shift))\b/i,
    /\b(5\s*year|long[\s-]?term)\s+(horizon|outlook|view|trend)/i,
    /\b(market\s+forces|industry\s+forces)\b/i,
    /\b(barriers?\s+to\s+entry|switching\s+costs?)\b/i,
    /\b(supplier\s+power|buyer\s+power)\b/i,
  ],
  weight: 0.95,
  lens: `Apply Kotler's macro framework + Porter's Five Forces. Two levels:

PESTEL · the external forces shaping the industry over 5+ years:
  · Political   · who's in office, what gets enforced
  · Economic    · local market conditions, recession sensitivity
  · Social      · driver behavior, generation shifts (Gen Z license rates)
  · Tech        · EVs reshaping service work, software eating diagnostics
  · Environmental · E-Check / emissions / right-to-repair
  · Legal       · franchise law, dealer-vs-independent service rules

PORTER'S FIVE FORCES · the structural forces shaping margin within
the industry:
  · Rivalry intensity      · how many competitors, on what dimensions?
  · New-entrant threat     · how cheap is it for a new shop to open?
  · Substitute threat      · DIY · dealer warranty service · subscription cars
  · Supplier power         · tire wholesalers, parts distributors
  · Buyer power            · customer alternatives, price transparency

Pick 1-2 forces that are MOVING right now (not the static ones). Map
how they change the playbook. Big-picture questions deserve a
structural answer, not a tactical one.`,
};
