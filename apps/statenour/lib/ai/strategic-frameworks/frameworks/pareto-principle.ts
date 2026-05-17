import type { StrategicFramework } from "../types";

/**
 * Pareto Principle (80/20) — Vilfredo Pareto's observation that ~80%
 * of effects come from ~20% of causes. Generalizes everywhere ·
 * customers · products · features · time · bugs · complaints. The
 * decision-relevant question · which 20% should I double down on,
 * which 80% should I ignore.
 */
export const paretoPrinciple: StrategicFramework = {
  id: "pareto-principle",
  name: "Pareto Principle (80/20)",
  oneLiner: "80% of effects come from 20% of causes. Find the 20% · double down · cut the rest.",
  triggers: [
    /\bpareto|80\/20|80\s*[\-–\/]\s*20\b/i,
    /\b(twenty\s+percent|eighty\s+percent)\b/i,
    /\b(vital\s+few|trivial\s+many)\b/i,
    /\b(top\s+(\d+|customers?|products?|categories?)\s+(by|drives))/i,
    /\b(disproportionate\s+(impact|share))\b/i,
    /\b(highest[\s-]leverage|highest[\s-]impact)/i,
    /\b(which\s+(few|customers?|products?|features?)\s+(drive|account\s+for))/i,
  ],
  weight: 0.95,
  lens: `Apply the Pareto Principle (80/20 rule). The pattern is
empirical · across hundreds of domains · ~80% of the effect comes
from ~20% of the inputs. Customers · revenue · profit · complaints ·
support tickets · feature usage · ad spend ROI · time spent on
tasks. The exact ratio varies (sometimes 90/10 or 70/30) · the
principle is the same · OUTPUT IS NOT EVENLY DISTRIBUTED.

The decision-relevant moves ·

  1. IDENTIFY THE VITAL 20% · run the data · who are the top-20%
     of customers by revenue · which top-20% of products drive
     most of profit · which 20% of marketing channels deliver
     most of leads · which 20% of complaints recur. Ranked list.

  2. AMPLIFY THE 20% · what would it take to do MORE with the
     vital few? More service for top customers · more inventory
     in the top SKUs · more spend on the proven channels.

  3. CUT or REDESIGN THE 80% · the trivial many usually consume
     resources without producing returns. Long tail customers
     who barely buy and complain a lot · low-margin SKUs you
     stock for "completeness" · channels that don't pencil. Cut
     them or productize them so they don't suck dedicated time.

The mistake people make · they treat all customers/products/efforts
as equal. They give the bottom-20% customer the same attention
as the top-20%. The result is that the top customers feel
neglected and the bottom customers stay marginal.

Three Pareto questions to ask weekly ·
  · what 20% of work this week produced 80% of progress?
  · what 20% of customers/leads should I be talking to today?
  · what 80% of activity could I stop doing with no harm?

Surface · the actual 20% in this situation · the action that
amplifies them · the action that cuts the bottom 80%.`,
};
