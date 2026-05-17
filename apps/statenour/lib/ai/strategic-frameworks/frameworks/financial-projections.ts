import type { StrategicFramework } from "../types";

/**
 * Financial Projections — forecasting revenue, expenses, and cashflow
 * over 3-12 months. Distinct from financial-modeling (deeper +
 * scenario-driven) · this is the lighter operator-level forecast for
 * "where will we be in 6 months at current trajectory."
 */
export const financialProjections: StrategicFramework = {
  id: "financial-projections",
  name: "Financial Projections (Operator Forecasting)",
  oneLiner: "Project from real recent data + named assumptions · review monthly · adjust when reality diverges.",
  triggers: [
    /\b(forecast|projection|projections|projecting)\b/i,
    /\b(where\s+will\s+(we|i|the\s+(business|shop))\s+be\s+(in\s+)?\d+\s+(months?|weeks?|quarters?|years?))/i,
    /\b(revenue\s+forecast|expense\s+forecast)\b/i,
    /\b(yearly\s+plan|annual\s+plan|next\s+year|next\s+quarter)\b/i,
    /\b(growth\s+rate|trajectory|run[\s-]?rate)\b/i,
    /\b(at\s+this\s+pace|at\s+current\s+rate)/i,
  ],
  weight: 0.95,
  lens: `Apply Operator-Level Financial Projections. Different from a full
financial model · this is the live forecast that should update
monthly.

  1. ANCHOR ON RECENT DATA · last 3 months of actuals beat 12 months
     of stale data. The most recent trend is the most predictive of
     the next 30-60 days.

  2. NAME 3 KEY ASSUMPTIONS · the projection is only as good as the
     assumptions. Most operator forecasts hide them.
       · Volume assumption (jobs / month, customers / month)
       · Price / mix assumption (avg ticket holding? rising?)
       · Cost assumption (parts up? wages up? rent flat?)
     Write them out · so when reality diverges, you know which
     assumption was wrong.

  3. PROJECT 3-6-12 · don't go past 12 months for an operator
     forecast · accuracy collapses past that. The 3-month is your
     working forecast · the 12-month is the framing.

  4. RECONCILE MONTHLY · compare projected vs actual at month-end.
     The DELTA is the learning · not the absolute number. If the
     forecast is 15% off two months running, the assumptions are
     wrong · not the model.

Surface the BUFFER · what's the runway / cash cushion if revenue
comes in 20% under projection? An honest operator forecast names the
margin of safety, not just the central case.`,
};
