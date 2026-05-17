import { customerRiskStatusValues, ltvBandValues } from "@/lib/domain";

import { daysSince } from "@/lib/utils/datetime";

type CustomerRiskStatus = (typeof customerRiskStatusValues)[number];
type LtvBand = (typeof ltvBandValues)[number];

export type DormantCustomerCandidate = {
  id: string;
  fullName: string;
  vehicle?: string | null;
  lastVisitDate?: string | Date | null;
  totalSpend: number;
  visitCount: number;
  lastService?: string | null;
  predictedNextService?: string | null;
  ltvBand?: LtvBand | null;
  manualRiskOverride?: CustomerRiskStatus | null;
  outreachDraftOverride?: string | null;
};

export type DormantCustomerResult = DormantCustomerCandidate & {
  daysSinceLastVisit: number | null;
  automatedRiskStatus: CustomerRiskStatus;
  effectiveRiskStatus: CustomerRiskStatus;
  recoveryScore: number;
  outreachDraft: string;
};

export function calculateLtvBand(totalSpend: number, visitCount: number): LtvBand {
  if (totalSpend >= 3500 || visitCount >= 8) {
    return "VIP";
  }

  if (totalSpend >= 1800 || visitCount >= 5) {
    return "HIGH";
  }

  if (totalSpend >= 700 || visitCount >= 2) {
    return "MID";
  }

  return "LOW";
}

function getAutomatedRisk(daysAway: number | null): CustomerRiskStatus {
  if (daysAway === null) {
    return "AT_RISK";
  }

  if (daysAway >= 365) {
    return "LOST";
  }

  if (daysAway >= 180) {
    return "DORMANT";
  }

  if (daysAway >= 90) {
    return "AT_RISK";
  }

  return "HEALTHY";
}

export function deriveRiskStatus(lastVisitDate?: string | Date | null, now = new Date()) {
  return getAutomatedRisk(daysSince(lastVisitDate, now));
}

function buildOutreachDraft(customer: DormantCustomerCandidate, daysAway: number | null) {
  const serviceHook = customer.predictedNextService || customer.lastService || "maintenance";
  const timing = daysAway === null ? "It's been a while" : `It has been ${daysAway} days`;

  return `Hi ${customer.fullName}, ${timing} since your last visit with us. If ${serviceHook.toLowerCase()} is coming up, I can help you lock in a clean plan this week. Want me to put together the best next option for your vehicle?`;
}

export function scanDormantCustomers(customers: DormantCustomerCandidate[], now = new Date()) {
  return customers
    .map((customer) => {
      const daysSinceLastVisit = daysSince(customer.lastVisitDate, now);
      const ltvBand = customer.ltvBand || calculateLtvBand(customer.totalSpend, customer.visitCount);
      const automatedRiskStatus = getAutomatedRisk(daysSinceLastVisit);
      const effectiveRiskStatus = customer.manualRiskOverride || automatedRiskStatus;
      const spendWeight = Math.min(customer.totalSpend / 90, 45);
      const visitWeight = Math.min(customer.visitCount * 3, 24);
      const recencyWeight = daysSinceLastVisit === null ? 14 : Math.min(daysSinceLastVisit / 6, 40);
      const ltvWeight = ltvBand === "VIP" ? 16 : ltvBand === "HIGH" ? 10 : ltvBand === "MID" ? 5 : 0;
      const recoveryScore = Math.round(spendWeight + visitWeight + recencyWeight + ltvWeight);

      return {
        ...customer,
        ltvBand,
        daysSinceLastVisit,
        automatedRiskStatus,
        effectiveRiskStatus,
        recoveryScore,
        outreachDraft: customer.outreachDraftOverride || buildOutreachDraft(customer, daysSinceLastVisit)
      } satisfies DormantCustomerResult;
    })
    .sort((left, right) => right.recoveryScore - left.recoveryScore);
}

export function scoreDormantCustomer(customer: DormantCustomerCandidate, now = new Date()) {
  return scanDormantCustomers([customer], now)[0] || null;
}
