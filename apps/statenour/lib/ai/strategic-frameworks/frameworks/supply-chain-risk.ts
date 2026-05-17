import type { StrategicFramework } from "../types";

/**
 * Supply Chain Risk Auditor — for any business that depends on
 * suppliers, parts, vendors. Tire shop = brand of tire + parts
 * distributor + warranty pipeline. Concentration risk is silent
 * until it isn't.
 */
export const supplyChainRisk: StrategicFramework = {
  id: "supply-chain-risk",
  name: "Supply Chain Risk Auditor",
  oneLiner: "Single-vendor dependency = single point of failure. Map suppliers, score concentration, plan the fallback.",
  triggers: [
    /\b(supplier|suppliers|vendor|vendors)\b/i,
    /\b(supply\s+chain|distribution|wholesale)\b/i,
    /\b(parts|inventory|stock(\s+out|ing)?|stockout)\b/i,
    /\b(distributor|wholesaler|tire\s+brand|alg|dk\s+tire)\b/i,
    /\b(concentration\s+risk|single\s+point\s+of\s+failure)\b/i,
    /\b(fallback\s+(supplier|vendor)|backup\s+(supplier|vendor))\b/i,
    /\b(price\s+hike|tariff|shortage|backorder)\b/i,
  ],
  weight: 0.95,
  lens: `Apply the Supply Chain Risk Auditor lens. Suppliers are the silent
killer · everything works until they don't.

  1. MAP THE DEPENDENCIES · for each input (tires, parts, software,
     shipping), name the supplier(s) + the % of volume they handle.
     Anything > 50% from one source is a concentration risk.

  2. SCORE THREE RISK DIMENSIONS:
       · Replaceability · how fast could you switch? Days / weeks / months?
       · Price elasticity · what happens if they raise prices 20%?
         Can you pass it through? Eat it? Walk away?
       · Reliability history · do they fulfill on time? What's the
         worst recent outage and how did you recover?

  3. PLAN THE FALLBACK BEFORE YOU NEED IT · for each high-risk
     supplier, name the backup. Test the fallback once a year so
     you know it works (placing a small order to a secondary
     supplier costs little, validates the relationship).

The decision: "do we need a fallback for this supplier" — usually
the answer is yes for the top 3 inputs. The cost of dual-sourcing
is small; the cost of a stockout during peak season is large.

Apply to: tire wholesale relationships · parts distributors · payment
processor · CRM software · key technicians (people are also
"suppliers" of capacity).`,
};
