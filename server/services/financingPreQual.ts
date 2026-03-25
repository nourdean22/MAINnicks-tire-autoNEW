/**
 * Financing Pre-Qualification — Soft recommendation (not a credit check)
 * Based on income range + credit tier, returns likely BNPL providers.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("financing");

interface PreQualResult {
  providers: {
    name: string;
    likelyApproved: boolean;
    estimatedMonthly: string;
    description: string;
    minAmount: number;
    maxAmount: number;
  }[];
  recommendation: string;
}

type CreditTier = "excellent" | "good" | "fair" | "poor" | "no-credit";

const PROVIDERS = [
  {
    name: "Acima",
    description: "No credit needed. Lease-to-own. $0 down options available.",
    creditTiers: ["excellent", "good", "fair", "poor", "no-credit"] as CreditTier[],
    minAmount: 300,
    maxAmount: 4000,
    approvalRate: 0.85,
  },
  {
    name: "Snap Finance",
    description: "Bad credit OK. Up to $5,000. 100-day same-as-cash option.",
    creditTiers: ["excellent", "good", "fair", "poor"] as CreditTier[],
    minAmount: 500,
    maxAmount: 5000,
    approvalRate: 0.75,
  },
  {
    name: "Koalafi",
    description: "Flexible approval. Lease-to-own with early buyout options.",
    creditTiers: ["excellent", "good", "fair", "poor"] as CreditTier[],
    minAmount: 300,
    maxAmount: 5000,
    approvalRate: 0.70,
  },
  {
    name: "American First Finance",
    description: "Wide approval range. Multiple plan options. Apply in 60 seconds.",
    creditTiers: ["excellent", "good", "fair", "poor", "no-credit"] as CreditTier[],
    minAmount: 300,
    maxAmount: 5000,
    approvalRate: 0.80,
  },
];

/**
 * Get pre-qualification recommendations based on credit tier and service cost.
 */
export function getFinancingPreQual(params: {
  creditTier: CreditTier;
  estimatedCost: number;
}): PreQualResult {
  const { creditTier, estimatedCost } = params;

  const eligible = PROVIDERS
    .filter((p) => p.creditTiers.includes(creditTier))
    .filter((p) => estimatedCost >= p.minAmount && estimatedCost <= p.maxAmount)
    .map((p) => {
      // Estimate monthly payment (rough: 12-month term)
      const monthly = Math.ceil(estimatedCost / 12);
      return {
        name: p.name,
        likelyApproved: p.approvalRate >= 0.7,
        estimatedMonthly: `~$${monthly}/mo`,
        description: p.description,
        minAmount: p.minAmount,
        maxAmount: p.maxAmount,
      };
    });

  let recommendation: string;
  if (eligible.length === 0) {
    recommendation = "Your repair cost may be below the financing minimum. Ask about our payment plans — call (216) 862-0005.";
  } else if (creditTier === "poor" || creditTier === "no-credit") {
    recommendation = `${eligible.length} financing options available. Acima and American First Finance have the highest approval rates for all credit levels.`;
  } else {
    recommendation = `${eligible.length} financing options available. Most customers are approved in under 60 seconds.`;
  }

  log.info("Financing pre-qual", { creditTier, estimatedCost, eligible: eligible.length });

  return { providers: eligible, recommendation };
}
