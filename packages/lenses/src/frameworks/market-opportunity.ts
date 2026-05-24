import type { StrategicFramework } from "../types";

/**
 * Market Opportunity Sizing — TAM/SAM/SOM. Right-size the bet against
 * the addressable market. Cleveland local market vs national rollout
 * are completely different decisions.
 */
export const marketOpportunity: StrategicFramework = {
  id: "market-opportunity",
  name: "Market Opportunity Sizing (TAM / SAM / SOM)",
  oneLiner: "TAM (everyone) → SAM (your reach) → SOM (capturable). Size the bet against the realistic capture, not the dream.",
  triggers: [
    /\b(TAM|SAM|SOM)\b/i,
    /\b(market\s+(size|sizing|opportunity|potential))\b/i,
    /\b(addressable\s+market|total\s+market)\b/i,
    /\b(how\s+big\s+(is|could)\s+(this|the)\s+(market|opportunity))/i,
    /\b(cleveland|local\s+market|geographic\s+market)\b/i,
    /\b(market\s+(share|capture)|share\s+of\s+(market|wallet))\b/i,
    /\b(serviceable\s+market|capturable)\b/i,
  ],
  weight: 1.0,
  lens: `Apply Market Opportunity Sizing. Three layers · be honest at each:

  1. TAM (Total Addressable Market) · everyone who could conceivably
     buy this. Big number, not actionable. For a tire shop · all car
     owners. For SaaS · all small businesses with the use case.

  2. SAM (Serviceable Addressable Market) · what YOUR business can
     reach given geography, channels, language. Cleveland tire shop ·
     drivers within 20 miles. Direct sales SaaS · companies your reps
     can call.

  3. SOM (Serviceable Obtainable Market) · what you'll realistically
     capture in the next 1-3 years given competition + capacity.
     Usually 1-10% of SAM. THIS is what you plan against.

The mistake operators make is planning against TAM ("a billion-dollar
market!") when SOM is the only number that determines whether the
business survives. Size the bet against the SOM · grow into the SAM
later.

Surface the SOM with two sanity checks: (a) is it large enough to
justify the investment, (b) is the assumed capture % plausible given
who else is competing for the same customers.`,
};
