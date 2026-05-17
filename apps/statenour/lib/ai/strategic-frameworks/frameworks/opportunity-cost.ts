import type { StrategicFramework } from "../types";

/**
 * Opportunity Cost — the true cost of any decision is what you DIDN'T
 * do with the same resources. The dollar / hour / unit-of-attention
 * has only one life · spending it on X means it can't go to Y. Most
 * "I'll do both" answers are actually "I'll do half of each, badly."
 */
export const opportunityCost: StrategicFramework = {
  id: "opportunity-cost",
  name: "Opportunity Cost",
  oneLiner: "The cost of any decision is what you DIDN'T do with the same resources. Saying yes is saying no to everything else. Resources don't multiply.",
  triggers: [
    /\bopportunity\s+costs?\b/i,
    /\b(trade[\s-]?off|tradeoffs?)\b/i,
    /\b(should\s+(i|we)\s+(spend|invest)\s+(time|money|resources)\s+on)/i,
    /\b(doing\s+both|do\s+both|both\s+at\s+(once|the\s+same\s+time))/i,
    /\b(saying\s+yes\s+(is\s+)?saying\s+no)/i,
    /\b(time\s+(is\s+)?(your\s+|our\s+)?(scarcest|most\s+(valuable|important))\s+resource)/i,
    /\b(focus\s+vs\s+(diversif|spread))/i,
    /\b(can't\s+do\s+everything|can\s+not\s+do\s+everything)/i,
  ],
  weight: 0.95,
  lens: `Apply Opportunity Cost. The principle is mechanical · every
dollar / hour / unit-of-attention spent on X is a dollar / hour /
unit-of-attention NOT spent on Y. Resources do not multiply.

Most operators get this wrong because they evaluate each option
in isolation ("is this worth doing?") instead of in pairs ("is
this worth doing INSTEAD OF the next-best thing?"). The first
question always feels yes. The second is the real question.

Three concrete applications ·

  1. TIME ALLOCATION · "Should I spend the morning on social
     media content?" · WRONG QUESTION. Right question · "Is
     2 hours on social better than 2 hours on the top customer
     I haven't called this month?" Compare to alternatives · not
     to nothing.

  2. CAPITAL ALLOCATION · "Should we invest  in this
     equipment?" · WRONG. Right · "Is  on equipment better
     than  on marketing OR  in payroll OR  saved as
     runway?" Each dollar has multiple homes · pick the highest
     return-per-dollar.

  3. ATTENTION ALLOCATION · "Should we add this feature?" · WRONG.
     Right · "Is this feature better than the next 5 features on
     the backlog · the bug fixes · the marketing time we'd lose?"
     Building feature N delays features N+1 through N+M.

THE 'I'LL DO BOTH' TRAP · saying yes to two things sounds like
doubling output · in practice it usually means each gets half-
attention · each takes 2x as long · neither hits the bar · both
fail. The opportunity cost of trying to do both is doing neither
well.

THE INVERSE TEST · for any decision · what would you do INSTEAD
if this option vanished tomorrow? If the answer is exciting,
the opportunity cost of choosing the original option is high ·
maybe choose the inverse. If the answer is "nothing better,"
the original option is genuinely the best move.

For Nick · every operational hour has alternative uses (call
top customer · review the financial dashboard · sit at the lift
helping the techs · plan the next quarter). Every dollar of
profit has alternative homes (reinvest · pay debt · save · pay
out). Every staff hour has alternative tasks. Surfacing the
opportunity cost makes the obvious-good options look genuinely
good or surprisingly bad.

Surface · the option being considered · the next-best alternative ·
the resources required · whether the option still wins after
comparison.`,
};
