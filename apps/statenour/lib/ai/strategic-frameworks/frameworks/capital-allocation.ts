import type { StrategicFramework } from "../types";

/**
 * Capital Allocation (William Thorndike "The Outsiders" / Mark Leonard) ·
 * the CEO's most important job is deciding where to deploy each dollar
 * of incremental capital. Reinvest? Acquire? Buy back stock? Pay
 * dividends? Keep cash? Each option has a different return profile.
 */
export const capitalAllocation: StrategicFramework = {
  id: "capital-allocation",
  name: "Capital Allocation (The Outsiders / Leonard)",
  oneLiner: "5 levers for every dollar · reinvest · acquire · buy back · dividend · hold cash. The right mix depends on the return-on-capital available.",
  triggers: [
    /\bcapital\s+allocation\b/i,
    /\b(thorndike|outsiders\s+(book|ceos?)|mark\s+leonard|constellation\s+software)\b/i,
    /\b(buyback|share\s+repurchase|stock\s+buyback)\b/i,
    /\b(reinvest\s+(profits?|cash|earnings))/i,
    /\b(dividend\s+(policy|decision|payout))/i,
    /\b(retain\s+earnings|retained\s+earnings)/i,
    /\b(where\s+to\s+(deploy|allocate|invest)\s+(capital|cash|profits?))/i,
    /\b(roi(c)?\s+vs|return\s+on\s+(invested\s+)?capital)/i,
    /\b(m\s*&\s*a|merger|acquisition\s+(strategy|target))\b/i,
  ],
  weight: 1.0,
  lens: `Apply the Capital Allocation lens. Thorndike's discovery in
"The Outsiders" · the eight CEOs whose stocks crushed the S&P
weren't operationally brilliant · they were CAPITAL ALLOCATORS.
Operational excellence is necessary · capital-allocation
discipline is what compounds.

Every dollar of free cash flow has 5 destinations ·

  1. REINVEST IN THE BUSINESS · expand existing operations · open
     new locations · build new capacity · R&D. Best when the
     incremental return exceeds the cost of capital.

  2. ACQUIRE · buy other businesses. Best when the target's price
     × your operational improvements > stand-alone fair value.
     Worst when M&A is empire-building (most M&A destroys value).

  3. BUY BACK STOCK · retire shares when the stock is undervalued.
     Best at low multiples · TERRIBLE at high multiples (which is
     when most companies actually buy back).

  4. PAY DIVIDENDS · return cash to shareholders. Best when no
     attractive reinvestment options exist AND the shareholders
     can put the cash to better use elsewhere.

  5. HOLD CASH · keep dry powder for opportunities. Best in
     uncertain markets / before downturns. Worst as a permanent
     state (cash drag on returns).

The decision rule · for every dollar, pick the option with the
highest risk-adjusted return on incremental capital. NOT the
option that "feels growth-like" or "feels conservative." Just the
math.

Common mistakes ·
  · Reinvesting in low-return projects because "we're a growth company"
  · Buying back stock at all-time highs (Boeing, GE before crashes)
  · Paying dividends from debt (the dividend trap)
  · M&A for empire-building (most public-company M&A destroys value)

For Nick · capital allocation for the tire shop is asking · for
each dollar of profit · is the highest return in (a) opening a
2nd location, (b) marketing the existing one harder, (c) hiring
another tech, (d) paying down debt, (e) keeping it as runway. The
RIGHT answer changes year to year.

Surface · the 5 options for the situation · the estimated return
on each · which option(s) deserve the next  dollar.`,
};
