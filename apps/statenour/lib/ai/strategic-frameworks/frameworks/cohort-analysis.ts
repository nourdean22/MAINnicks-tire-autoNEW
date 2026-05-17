import type { StrategicFramework } from "../types";

/**
 * Cohort Analysis — group customers by acquisition period (or other
 * shared attribute) then track their behavior over time. Reveals
 * truths that aggregate metrics hide. Is retention actually getting
 * better, or just diluted by new customers?
 */
export const cohortAnalysis: StrategicFramework = {
  id: "cohort-analysis",
  name: "Cohort Analysis (retention truth-teller)",
  oneLiner: "Group customers by when they joined · track over time · reveals retention curves the aggregate hides.",
  triggers: [
    /\bcohort\s+(analysis|table|view|chart)\b/i,
    /\b(retention\s+(curve|cohort|by\s+month))/i,
    /\b(month\s+\d+\s+retention)/i,
    /\b(stickiness|usage\s+over\s+time)/i,
    /\b(is\s+retention\s+(actually\s+)?(getting|improving|getting\s+better|worse))/i,
    /\b(early\s+vs\s+late\s+(customers?|users?|cohorts?))/i,
    /\b(class\s+of\s+(\d{4}|january|february|march|april|may|june|july|august|september|october|november|december))/i,
  ],
  weight: 1.0,
  lens: `Apply Cohort Analysis. The aggregate "monthly retention rate"
lies · it blends new customers with veterans, blends winning
months with losing months, hides changes that matter.

Cohort analysis fixes that · group customers by the period (or
attribute) they're acquired in, then track each cohort's retention
month-by-month. The output is a triangular table ·

  Acquired    M1     M2     M3     M4     M5     M6
  Jan 2025    100%   62%    51%    47%    44%    42%
  Feb 2025    100%   68%    55%    50%    47%    —
  Mar 2025    100%   71%    59%    54%    —      —
  Apr 2025    100%   74%    61%    —      —      —

Reading the table ·

  · DOWN a column · is the same-month retention IMPROVING for
    later cohorts? (Are we getting better at retention?)
  · ACROSS a row · how does ONE cohort decay over time? (What's
    the natural decay curve · where does it flatten?)
  · DIAGONAL · the most recent month for each cohort · the
    "horizon" of what we know.

The most important question · DOES THE CURVE FLATTEN? Healthy
businesses see retention drop fast in the first 1-3 months then
stabilize. If it keeps dropping, the customers are leaking · if
it flattens at 20%, the long-term ARPU is set by that 20%.

The product question · what changed between cohorts where
retention curves are different? Onboarding · pricing · channel ·
season · feature set. The cohort table makes the AB-test
visible without running an AB test.

For a tire shop · cohorts grouped by first-service-month, tracked
by "did they come back within X months." If recent cohorts return
more reliably, something in the customer experience is improving.
If they return less, find what changed and unwind it.

Surface · the cohort table for the question · what column or
row is telling the strongest story · what hypothesis explains it.`,
};
