import type { StrategicFramework } from "../types";

/**
 * Unit Economics — the per-customer P&L. If the unit doesn't work,
 * scale makes the loss bigger, not smaller. CAC · LTV · payback ·
 * contribution margin · the four numbers that determine whether the
 * business can grow.
 */
export const unitEconomics: StrategicFramework = {
  id: "unit-economics",
  name: "Unit Economics (per-customer P&L)",
  oneLiner: "Per-customer profit math · CAC · LTV · payback period · contribution margin. If the unit loses money, scaling makes it worse.",
  triggers: [
    /\b(unit\s+economics|per[\s-](customer|unit)\s+(profit|economics|p&l))/i,
    /\b(ltv\s*[/:to]\s*cac|cac\s+payback|payback\s+period)\b/i,
    /\b(contribution\s+margin|cogs|cost\s+of\s+goods)\b/i,
    /\b(does\s+(the|this)\s+(unit|math)\s+work)/i,
    /\b(can\s+we\s+(profitably\s+)?scale\s+this)/i,
    /\b(blended\s+cac|paid\s+cac|organic\s+cac)\b/i,
    /\b(per[\s-](ticket|order|job|customer)\s+(margin|profit))/i,
    /\b(gross\s+margin\s+per\s+(customer|unit|order))/i,
  ],
  weight: 1.05,
  lens: `Apply Unit Economics. Before talking about scaling, prove the
single-customer math works. Four numbers ·

  1. CAC (Customer Acquisition Cost) · all sales + marketing $$
     spent in a period ÷ new customers acquired. Be honest · include
     ad spend, agency fees, commissions, free samples, your time at a
     fair rate. CAC of  with  of margin per customer is a problem.

  2. LTV (Lifetime Value) · gross profit per customer × expected
     lifetime in months/years. Don't use revenue · use gross profit
     net of variable costs (parts · labor · payment processing).

  3. LTV ÷ CAC RATIO · benchmark · 3:1 is healthy · 1:1 is
     break-even · less than 1:1 is bleeding cash. SaaS is usually
     judged at 3:1 · service businesses can run thinner if payback
     is fast.

  4. CAC PAYBACK PERIOD · how many months until you get the CAC
     back from gross profit? <12 months is healthy · 24+ months
     means you need a lot of capital to grow.

The tire-shop translation · cost-per-lead via Google ads + close
rate = paid CAC. Avg ticket × repeat-visits over 5 years × gross
margin % = LTV. If LTV/CAC < 2 the growth machine is leaking · the
fix is upstream (better targeting, raise prices, increase repeat
visits, add referral mechanic) before pouring more money into ads.

Surface the actual numbers · then surface what changes them most ·
usually one or two levers move the ratio more than the rest combined.`,
};
