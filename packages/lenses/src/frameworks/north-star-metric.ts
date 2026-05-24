import type { StrategicFramework } from "../types";

/**
 * North Star Metric — the single number that captures the value the
 * business delivers + leads to long-term durable growth. Forces
 * focus · everything else is an input metric.
 */
export const northStarMetric: StrategicFramework = {
  id: "north-star-metric",
  name: "North Star Metric",
  oneLiner: "ONE metric that captures the value delivered + predicts long-term growth. Everything else is an input. Focus is the point.",
  triggers: [
    /\b(north\s+star\s+(metric|kpi)?)\b/i,
    /\b(one\s+metric\s+that\s+matters|omtm)\b/i,
    /\b(what\s+(metric|kpi)\s+should\s+(we|i)\s+(track|focus|measure))/i,
    /\b(single\s+metric|one\s+number|key\s+metric)\b/i,
    /\b(metric\s+that\s+(drives|predicts|matters))/i,
    /\b(focus\s+(on|the\s+team)\s+on\s+(one|a)\s+(metric|number|kpi))/i,
    /\b(growth\s+metric|leading\s+indicator\s+of\s+growth)\b/i,
  ],
  weight: 0.95,
  featured: true, // 2026-05-23 · Wave E · baseline lens shown in generic fallback
  lens: `Apply the North Star Metric lens. The point is FOCUS · most
businesses track 30+ metrics and improve none of them because the
team's attention is fragmented. The North Star is the ONE metric
that, if it goes up, the business is winning. Two filters ·

  1. CAPTURES VALUE DELIVERED · does the metric track the moment a
     customer gets the thing they came for? Airbnb · "nights booked"
     not "site visits." Tire shop · "completed services" not
     "appointments scheduled." Tickets-rung is a vanity metric ·
     return-trips-per-customer-per-year is closer.

  2. PREDICTS LONG-TERM GROWTH · would moving this metric next month
     make the business meaningfully better in 12 months? "Five-star
     reviews" probably yes (referrals, SEO). "Ad clicks" probably
     no (just spend more, paid-CAC goes up).

The North Star is paired with INPUT METRICS · the 3-5 levers that
move the North Star. If North Star is "completed services per
month" · inputs might be · (a) leads per week, (b) close rate, (c)
average services per ticket, (d) repeat-customer rate.

The whole team rallies around the North Star · individual roles own
input metrics. When inputs disagree about what to do, the North
Star is the tiebreaker.

Surface · what's the North Star here · what are the 3-5 inputs ·
which input is currently the weakest link.`,
};
