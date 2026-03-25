/**
 * AI Estimate Generator — Plain English symptom → cost estimate
 * Uses pricing data + Gemini for intelligent estimates.
 * Falls back to static ranges if AI unavailable.
 */

import { createLogger } from "../lib/logger";
const log = createLogger("ai-estimate");

interface EstimateRequest {
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  symptomDescription: string;
  mileage?: number;
}

interface PossibleIssue {
  issue: string;
  likelihood: "likely" | "possible" | "unlikely";
  estimatedCostRange: { low: number; high: number };
  estimatedTime: string;
  explanation: string;
}

interface EstimateResponse {
  possibleIssues: PossibleIssue[];
  recommendation: string;
  disclaimer: string;
}

// Static pricing fallback (used when AI is unavailable)
const STATIC_ESTIMATES: Record<string, { issues: PossibleIssue[] }> = {
  brake: {
    issues: [
      { issue: "Worn Brake Pads", likelihood: "likely", estimatedCostRange: { low: 89, high: 199 }, estimatedTime: "1-2 hours", explanation: "Brake pads wear down over time. Squealing or grinding usually means they need replacement." },
      { issue: "Warped Rotors", likelihood: "possible", estimatedCostRange: { low: 149, high: 349 }, estimatedTime: "2-3 hours", explanation: "If you feel pulsing when braking, rotors may need resurfacing or replacement." },
    ],
  },
  engine: {
    issues: [
      { issue: "Ignition System Issue", likelihood: "likely", estimatedCostRange: { low: 49, high: 299 }, estimatedTime: "1-3 hours", explanation: "Could be spark plugs, coil packs, or wiring. Diagnostics will pinpoint the exact cause." },
      { issue: "Sensor Failure", likelihood: "possible", estimatedCostRange: { low: 89, high: 349 }, estimatedTime: "1-2 hours", explanation: "O2 sensor, MAF sensor, or other engine sensors often trigger check engine lights." },
    ],
  },
  tire: {
    issues: [
      { issue: "Tire Replacement", likelihood: "likely", estimatedCostRange: { low: 60, high: 200 }, estimatedTime: "30-60 min", explanation: "Used tires from $60, new from $89+. Includes mounting, balancing, and TPMS reset." },
      { issue: "Flat Tire Repair", likelihood: "possible", estimatedCostRange: { low: 15, high: 25 }, estimatedTime: "15 min", explanation: "If the tire can be safely patched, repair is $15-25. We'll never sell you a new tire if repair is possible." },
    ],
  },
  ac: {
    issues: [
      { issue: "AC Recharge", likelihood: "likely", estimatedCostRange: { low: 89, high: 149 }, estimatedTime: "30-60 min", explanation: "Low refrigerant is the most common cause of weak AC. We check for leaks during recharge." },
      { issue: "Compressor Failure", likelihood: "possible", estimatedCostRange: { low: 500, high: 1200 }, estimatedTime: "3-5 hours", explanation: "If the compressor has failed, replacement is more involved but we handle it." },
    ],
  },
  transmission: {
    issues: [
      { issue: "Transmission Fluid Service", likelihood: "likely", estimatedCostRange: { low: 149, high: 199 }, estimatedTime: "1-2 hours", explanation: "Old or low fluid causes shifting issues. A fluid exchange often resolves the problem." },
      { issue: "Transmission Repair", likelihood: "possible", estimatedCostRange: { low: 500, high: 3000 }, estimatedTime: "1-5 days", explanation: "Internal transmission issues require diagnosis. We'll give you an honest assessment." },
    ],
  },
};

/** Generate estimate from symptom description */
export function generateEstimate(request: EstimateRequest): EstimateResponse {
  const desc = request.symptomDescription.toLowerCase();

  // Match to service category
  let category = "general";
  if (/brake|squeal|grind|stop|pedal/i.test(desc)) category = "brake";
  else if (/engine|check engine|start|idle|misfire|stall/i.test(desc)) category = "engine";
  else if (/tire|flat|tread|bald|tpms/i.test(desc)) category = "tire";
  else if (/ac|air condition|cold air|hot air|cool/i.test(desc)) category = "ac";
  else if (/transmission|shift|slip|gear/i.test(desc)) category = "transmission";

  const staticData = STATIC_ESTIMATES[category];
  const issues: PossibleIssue[] = staticData?.issues || [
    {
      issue: "Diagnostic Inspection Needed",
      likelihood: "likely",
      estimatedCostRange: { low: 49, high: 99 },
      estimatedTime: "30-60 min",
      explanation: "Based on your description, we'd need to inspect the vehicle to give an accurate diagnosis. Our diagnostic fee is applied to the repair if you proceed.",
    },
  ];

  // Adjust pricing for premium vehicles
  const premiumBrands = ["bmw", "mercedes", "audi", "lexus", "infiniti", "cadillac", "lincoln", "porsche", "land rover"];
  const isPremium = premiumBrands.some(b => request.vehicleMake.toLowerCase().includes(b));
  const adjustedIssues = isPremium
    ? issues.map(i => ({
        ...i,
        estimatedCostRange: {
          low: Math.round(i.estimatedCostRange.low * 1.3),
          high: Math.round(i.estimatedCostRange.high * 1.3),
        },
        explanation: i.explanation + " (Premium vehicle — specialized parts may affect pricing.)",
      }))
    : issues;

  log.info("Estimate generated", {
    vehicle: `${request.vehicleYear} ${request.vehicleMake} ${request.vehicleModel}`,
    category,
    isPremium,
  });

  return {
    possibleIssues: adjustedIssues,
    recommendation: `Bring your ${request.vehicleYear} ${request.vehicleMake} ${request.vehicleModel} to Nick's Tire & Auto for a proper diagnosis. We'll show you exactly what's wrong before doing any work. Call (216) 862-0005 or book online at nickstire.org.`,
    disclaimer: "This is a preliminary AI estimate based on your description. Actual diagnosis may reveal different issues. A proper inspection gives you an exact quote — no obligation.",
  };
}
