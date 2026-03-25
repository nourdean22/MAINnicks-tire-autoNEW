/**
 * Customer Lifetime Value (CLV) Calculator
 * Calculates: total spent, avg order, visit frequency, predicted next visit,
 * estimated annual value, risk score (0-100).
 */

import { createLogger } from "../lib/logger";

const log = createLogger("clv");

interface CLVResult {
  totalSpent: number;
  avgOrderValue: number;
  visitCount: number;
  avgDaysBetweenVisits: number;
  predictedNextVisitDate: Date | null;
  estimatedAnnualValue: number;
  riskScore: number; // 0-100, higher = more at risk of churning
  riskLevel: "low" | "medium" | "high" | "critical";
}

/**
 * Calculate CLV for a customer based on their visit history.
 */
export function calculateCLV(params: {
  totalSpent: number;
  visitCount: number;
  firstVisitDate: Date;
  lastVisitDate: Date;
  visitDates?: Date[];
}): CLVResult {
  const { totalSpent, visitCount, firstVisitDate, lastVisitDate } = params;

  // Average order value
  const avgOrderValue = visitCount > 0 ? totalSpent / visitCount : 0;

  // Average days between visits
  const totalDays = Math.max(1, (lastVisitDate.getTime() - firstVisitDate.getTime()) / (1000 * 60 * 60 * 24));
  const avgDaysBetweenVisits = visitCount > 1 ? totalDays / (visitCount - 1) : 90; // default 90 days

  // Predicted next visit
  const daysSinceLastVisit = (Date.now() - lastVisitDate.getTime()) / (1000 * 60 * 60 * 24);
  const predictedNextVisitDate = new Date(lastVisitDate.getTime() + avgDaysBetweenVisits * 24 * 60 * 60 * 1000);

  // Estimated annual value
  const visitsPerYear = 365 / avgDaysBetweenVisits;
  const estimatedAnnualValue = avgOrderValue * visitsPerYear;

  // Risk score — how overdue are they relative to their normal frequency?
  let riskScore = 0;
  if (visitCount >= 2) {
    const overdueRatio = daysSinceLastVisit / avgDaysBetweenVisits;
    if (overdueRatio <= 1.0) riskScore = 0;
    else if (overdueRatio <= 1.5) riskScore = 25;
    else if (overdueRatio <= 2.0) riskScore = 50;
    else if (overdueRatio <= 3.0) riskScore = 75;
    else riskScore = 95;
  } else {
    // Single visit — risk based on time since visit
    if (daysSinceLastVisit > 365) riskScore = 90;
    else if (daysSinceLastVisit > 180) riskScore = 70;
    else if (daysSinceLastVisit > 90) riskScore = 40;
    else riskScore = 10;
  }

  let riskLevel: "low" | "medium" | "high" | "critical";
  if (riskScore >= 80) riskLevel = "critical";
  else if (riskScore >= 50) riskLevel = "high";
  else if (riskScore >= 25) riskLevel = "medium";
  else riskLevel = "low";

  return {
    totalSpent,
    avgOrderValue: Math.round(avgOrderValue * 100) / 100,
    visitCount,
    avgDaysBetweenVisits: Math.round(avgDaysBetweenVisits),
    predictedNextVisitDate,
    estimatedAnnualValue: Math.round(estimatedAnnualValue * 100) / 100,
    riskScore,
    riskLevel,
  };
}
