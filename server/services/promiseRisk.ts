/**
 * Promise Risk Engine — Calculates risk of missing promise times.
 *
 * Risk levels: on_track | at_risk | likely_late | overdue
 *
 * Factors:
 *   - Time remaining vs estimated work
 *   - Parts status (waiting = risk)
 *   - Bay availability
 *   - Tech load
 *   - Blocker status
 */
import { eq, and, isNotNull, lt, gte, inArray, sql } from "drizzle-orm";

async function getDbAndSchema() {
  const { getDb } = await import("../db");
  const schema = await import("../../drizzle/schema");
  const d = getDb();
  if (!d) throw new Error("Database not available");
  return { db: d, ...schema };
}

export type RiskLevel = "on_track" | "at_risk" | "likely_late" | "overdue";

export interface PromiseRiskResult {
  workOrderId: string;
  orderNumber: string;
  customerName?: string;
  vehicle?: string;
  promisedAt: string;
  status: string;
  risk: RiskLevel;
  riskScore: number; // 0-100
  reasons: string[];
  minutesRemaining: number;
  assignedTech: string | null;
  assignedBay: string | null;
}

// ─── Calculate risk for all active work orders with promise times ────
export async function getAtRiskJobs(): Promise<PromiseRiskResult[]> {
  const { db, workOrders } = await getDbAndSchema();

  const activeStatuses = [
    "approved", "parts_needed", "parts_ordered", "parts_partial",
    "parts_received", "ready_for_bay", "assigned", "in_progress", "qc_review",
  ];

  const jobs = await db.select().from(workOrders)
    .where(and(
      inArray(workOrders.status, activeStatuses),
      isNotNull(workOrders.promisedAt),
    ));

  const now = Date.now();

  return jobs
    .map(wo => calculateRisk(wo, now))
    .sort((a, b) => b.riskScore - a.riskScore);
}

function calculateRisk(wo: any, now: number): PromiseRiskResult {
  const promisedMs = new Date(wo.promisedAt).getTime();
  const minutesRemaining = Math.floor((promisedMs - now) / 60000);
  const reasons: string[] = [];
  let riskScore = 0;

  // 1. Time remaining
  if (minutesRemaining <= 0) {
    riskScore += 50;
    reasons.push(`Overdue by ${Math.abs(minutesRemaining)} min`);
  } else if (minutesRemaining <= 30) {
    riskScore += 40;
    reasons.push(`Only ${minutesRemaining} min remaining`);
  } else if (minutesRemaining <= 60) {
    riskScore += 25;
    reasons.push(`${minutesRemaining} min remaining`);
  } else if (minutesRemaining <= 120) {
    riskScore += 10;
  }

  // 2. Status-based risk
  const statusRisk: Record<string, number> = {
    approved: 20,
    parts_needed: 35,
    parts_ordered: 30,
    parts_partial: 25,
    parts_received: 10,
    ready_for_bay: 15,
    assigned: 5,
    in_progress: 0,
    qc_review: 0,
  };
  const sRisk = statusRisk[wo.status] || 0;
  if (sRisk > 0) {
    riskScore += sRisk;
    if (wo.status.startsWith("parts")) reasons.push(`Still in ${wo.status.replace(/_/g, " ")}`);
    else if (wo.status === "ready_for_bay") reasons.push("Waiting for bay");
    else if (wo.status === "approved") reasons.push("Not started yet");
  }

  // 3. Blocker
  if (wo.blockerType) {
    riskScore += 20;
    reasons.push(`Blocked: ${wo.blockerType.replace(/_/g, " ")}`);
  }

  // 4. No tech assigned
  if (!wo.assignedTechId && !["approved", "parts_needed", "parts_ordered", "parts_partial", "parts_received"].includes(wo.status)) {
    riskScore += 10;
    reasons.push("No tech assigned");
  }

  // Cap at 100
  riskScore = Math.min(100, riskScore);

  // Determine level
  let risk: RiskLevel;
  if (minutesRemaining <= 0) risk = "overdue";
  else if (riskScore >= 60) risk = "likely_late";
  else if (riskScore >= 30) risk = "at_risk";
  else risk = "on_track";

  const vehicle = [wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(" ");

  return {
    workOrderId: wo.id,
    orderNumber: wo.orderNumber,
    vehicle: vehicle || undefined,
    promisedAt: wo.promisedAt.toISOString(),
    status: wo.status,
    risk,
    riskScore,
    reasons,
    minutesRemaining,
    assignedTech: wo.assignedTech,
    assignedBay: wo.assignedBay,
  };
}

// ─── Summary stats ──────────────────────────────────
export async function getPromiseRiskSummary() {
  const risks = await getAtRiskJobs();
  return {
    total: risks.length,
    onTrack: risks.filter(r => r.risk === "on_track").length,
    atRisk: risks.filter(r => r.risk === "at_risk").length,
    likelyLate: risks.filter(r => r.risk === "likely_late").length,
    overdue: risks.filter(r => r.risk === "overdue").length,
    jobs: risks,
  };
}
