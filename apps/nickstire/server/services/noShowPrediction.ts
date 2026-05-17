/**
 * No-Show Prediction — scores upcoming bookings for likelihood of no-show so
 * the admin can proactively confirm the risky ones (SMS or phone).
 *
 * This is a heuristic scorer, not ML. Shops at our scale don't have enough
 * no-show labels for a real model yet, but the heuristic catches the obvious
 * cases that kill a workday:
 *   - Booking made > 3 days in advance (lead time drift)
 *   - Customer has past no-show / cancel pattern
 *   - First-time customer + no explicit confirmation
 *   - Emergency urgency that somehow got pushed a week out (mismatch)
 *   - Booking is for early morning / late afternoon (common no-show slots)
 *
 * Public API:
 *   scoreBooking(bookingId)           — single booking, full detail
 *   listAtRiskBookings(limit)         — bulk scan for admin dashboard
 *   getNoShowStats(days)              — historical no-show rate + drivers
 */

import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";
import { sql, eq, and, gte, desc } from "drizzle-orm";
import { bookings } from "../../drizzle/schema";
import { BUSINESS } from "@shared/business";

const log = createLogger("services:noShowPrediction");

// ─── Signals & weights ─────────────────────────────────
// Each signal contributes 0-100 to a weighted average. Weight sums to 1.0.

interface Signal {
  weight: number;
  label: string;
  value: number;      // 0-100
  reason: string;
}

export interface NoShowScore {
  bookingId: number;
  customerName: string;
  customerPhone: string;
  service: string;
  preferredDate: string | null;
  preferredTime: string;
  stage: string;
  createdAt: Date;
  /** 0-100 score — higher = more likely to no-show */
  riskScore: number;
  /** Categorical banding */
  riskBand: "low" | "medium" | "high" | "critical";
  /** Individual signals that went into the score */
  signals: Signal[];
  /** Suggested action for the admin */
  recommendedAction: string;
  /** Pre-drafted confirmation SMS */
  suggestedSms: string;
  /** Was the booking already confirmed? If so, skip outreach. */
  alreadyConfirmed: boolean;
}

// ─── Helpers ───────────────────────────────────────────

function daysBetween(a: Date, b: Date = new Date()): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  try {
    const parts = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parts) return null;
    const target = new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return Math.floor((target.getTime() - today.getTime()) / 86_400_000);
  } catch {
    return null;
  }
}

// ─── Signal computers ──────────────────────────────────

function signalLeadTime(createdAt: Date, preferredDate: string | null): Signal {
  const preferred = preferredDate ? daysUntil(preferredDate) : null;
  const leadDays = preferred !== null ? preferred : daysBetween(createdAt);

  // Longer lead times → higher no-show risk (they forget, plans change)
  let value: number;
  let reason: string;
  if (leadDays <= 0) {
    value = 5;
    reason = "Same-day appointment — high intent";
  } else if (leadDays <= 1) {
    value = 15;
    reason = "Within 24h — lower drift risk";
  } else if (leadDays <= 3) {
    value = 35;
    reason = `${leadDays} days out — moderate drift risk`;
  } else if (leadDays <= 7) {
    value = 60;
    reason = `${leadDays} days out — elevated drift risk`;
  } else {
    value = 80;
    reason = `${leadDays} days out — high drift risk (plans change)`;
  }
  return { weight: 0.25, label: "Lead time", value, reason };
}

function signalUrgency(urgency: string): Signal {
  // Emergency = highest show-up intent. "whenever" = lowest.
  const byUrgency: Record<string, { value: number; reason: string }> = {
    emergency: { value: 8, reason: "Emergency — very high intent" },
    "this-week": { value: 30, reason: "This week — moderate intent" },
    whenever: { value: 65, reason: "No urgency — lower intent, skippable" },
  };
  const info = byUrgency[urgency] ?? byUrgency.whenever;
  return { weight: 0.2, label: "Urgency", value: info.value, reason: info.reason };
}

function signalTimeOfDay(preferredTime: string): Signal {
  // Morning = most reliable, late afternoon = most likely to no-show (kids,
  // end-of-day energy drain). "no-preference" = middle.
  const byTime: Record<string, { value: number; reason: string }> = {
    morning: { value: 20, reason: "Morning slot — reliable" },
    afternoon: { value: 50, reason: "Afternoon — moderate drift risk" },
    "no-preference": { value: 40, reason: "Flexible time — moderate" },
  };
  const info = byTime[preferredTime] ?? byTime["no-preference"];
  return { weight: 0.15, label: "Time window", value: info.value, reason: info.reason };
}

function signalConfirmationStatus(
  status: string,
  confirmedAt: Date | null,
): Signal {
  if (status === "confirmed" || confirmedAt) {
    return {
      weight: 0.25,
      label: "Confirmation",
      value: 10,
      reason: "Explicitly confirmed — low risk",
    };
  }
  if (status === "new") {
    return {
      weight: 0.25,
      label: "Confirmation",
      value: 70,
      reason: "Not yet confirmed — significant risk",
    };
  }
  return { weight: 0.25, label: "Confirmation", value: 40, reason: `Status: ${status}` };
}

async function signalCustomerHistory(
  customerPhone: string,
  currentBookingId: number,
): Promise<Signal> {
  const d = await db();
  if (!d) {
    return { weight: 0.15, label: "Customer history", value: 50, reason: "No DB — assume neutral" };
  }
  try {
    const rows = await d
      .select({
        id: bookings.id,
        status: bookings.status,
        preferredDate: bookings.preferredDate,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.phone, customerPhone),
          sql`${bookings.id} != ${currentBookingId}`,
        ),
      )
      .orderBy(desc(bookings.createdAt))
      .limit(20);

    if (rows.length === 0) {
      return {
        weight: 0.15,
        label: "Customer history",
        value: 55,
        reason: "New customer — no baseline",
      };
    }

    type HistoryRow = { id: number; status: string; preferredDate: string | null; createdAt: Date };
    const historyRows = rows as unknown as HistoryRow[];
    const completed = historyRows.filter((r) => r.status === "completed").length;
    const cancelled = historyRows.filter((r) => r.status === "cancelled").length;
    const total = historyRows.length;
    const cancelRate = total > 0 ? cancelled / total : 0;
    const completionRate = total > 0 ? completed / total : 0;

    let value: number;
    let reason: string;
    if (cancelRate >= 0.5) {
      value = 85;
      reason = `History: ${cancelled}/${total} cancelled — HIGH no-show pattern`;
    } else if (cancelRate >= 0.3) {
      value = 65;
      reason = `History: ${cancelled}/${total} cancelled — elevated risk`;
    } else if (completionRate >= 0.7) {
      value = 15;
      reason = `History: ${completed}/${total} completed — reliable customer`;
    } else {
      value = 40;
      reason = `History: ${completed} done, ${cancelled} cancelled (${total} total)`;
    }
    return { weight: 0.15, label: "Customer history", value, reason };
  } catch (err) {
    log.warn("signalCustomerHistory failed", { error: err instanceof Error ? err.message : String(err) });
    return { weight: 0.15, label: "Customer history", value: 50, reason: "History lookup failed" };
  }
}

// ─── Score composition ─────────────────────────────────

function combineSignals(signals: Signal[]): { score: number; band: NoShowScore["riskBand"] } {
  const weightSum = signals.reduce((s, x) => s + x.weight, 0);
  const weighted = signals.reduce((s, x) => s + x.value * x.weight, 0);
  const score = Math.round(weighted / (weightSum || 1));

  let band: NoShowScore["riskBand"];
  if (score >= 75) band = "critical";
  else if (score >= 55) band = "high";
  else if (score >= 35) band = "medium";
  else band = "low";

  return { score, band };
}

function buildRecommendedAction(band: NoShowScore["riskBand"], daysUntilAppt: number | null): string {
  if (band === "critical") {
    return daysUntilAppt !== null && daysUntilAppt <= 1
      ? "CALL personally to confirm — high no-show risk this close to the appointment"
      : "Send confirmation SMS now + follow up with call if no reply in 4 hours";
  }
  if (band === "high") {
    return "Send confirmation SMS. If no reply in 24h, follow up.";
  }
  if (band === "medium") {
    return "Standard reminder — schedule auto-SMS at 24h before";
  }
  return "Low risk — standard reminder cadence is fine";
}

function buildSuggestedSms(name: string, service: string, date: string | null): string {
  const firstName = name.split(/\s+/)[0] || "there";
  const dateNote = date ? ` scheduled for ${date}` : "";
  return (
    `Hi ${firstName}, it's Nick's Tire & Auto. Just confirming your ${service.toLowerCase()}${dateNote}. ` +
    `Reply YES to confirm, or call ${BUSINESS.phone.display} to reschedule. ` +
    `Remember — we do drop-offs, just pull up any time!`
  );
}

// ─── Public API ────────────────────────────────────────

export async function scoreBooking(bookingId: number): Promise<NoShowScore | null> {
  const d = await db();
  if (!d) return null;

  const [row] = await d
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row) return null;

  const signals: Signal[] = [
    signalLeadTime(row.createdAt, row.preferredDate),
    signalUrgency(row.urgency),
    signalTimeOfDay(row.preferredTime),
    signalConfirmationStatus(row.status, row.confirmedAt),
    await signalCustomerHistory(row.phone, row.id),
  ];

  const { score, band } = combineSignals(signals);
  const daysUntilAppt = row.preferredDate ? daysUntil(row.preferredDate) : null;

  return {
    bookingId: row.id,
    customerName: row.name,
    customerPhone: row.phone,
    service: row.service,
    preferredDate: row.preferredDate,
    preferredTime: row.preferredTime,
    stage: row.stage,
    createdAt: row.createdAt,
    riskScore: score,
    riskBand: band,
    signals,
    recommendedAction: buildRecommendedAction(band, daysUntilAppt),
    suggestedSms: buildSuggestedSms(row.name, row.service, row.preferredDate),
    alreadyConfirmed: row.status === "confirmed" || !!row.confirmedAt,
  };
}

/**
 * Bulk scan — returns all upcoming bookings ordered by risk.
 * Skips already-completed / cancelled bookings and bookings whose
 * preferred date is in the past.
 */
export async function listAtRiskBookings(limit: number = 50): Promise<NoShowScore[]> {
  const d = await db();
  if (!d) return [];

  try {
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });

    // Pull upcoming bookings — either preferredDate >= today or no preferredDate and created within 7 days
    const rows = await d
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          sql`${bookings.status} IN ('new', 'confirmed')`,
          sql`(${bookings.preferredDate} >= ${todayStr} OR ${bookings.preferredDate} IS NULL OR ${bookings.preferredDate} = '')`,
          gte(bookings.createdAt, new Date(Date.now() - 30 * 86_400_000)),
        ),
      )
      .orderBy(desc(bookings.createdAt))
      .limit(Math.min(limit * 3, 200));

    const scored: NoShowScore[] = [];
    for (const r of rows) {
      const score = await scoreBooking(r.id);
      if (score) scored.push(score);
      if (scored.length >= limit) break;
    }

    // Sort by risk DESC, then by earliest preferredDate
    scored.sort((a, b) => {
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      const aDate = a.preferredDate ? daysUntil(a.preferredDate) ?? 999 : 999;
      const bDate = b.preferredDate ? daysUntil(b.preferredDate) ?? 999 : 999;
      return aDate - bDate;
    });

    return scored;
  } catch (err) {
    log.warn("listAtRiskBookings failed", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/**
 * Historical no-show stats over the last N days.
 * Used for admin dashboard trend display.
 */
export async function getNoShowStats(days: number = 30): Promise<{
  totalBookings: number;
  cancelledCount: number;
  cancelRate: number;
  completedCount: number;
  completionRate: number;
  trend: "improving" | "worsening" | "stable";
}> {
  const d = await db();
  if (!d) return { totalBookings: 0, cancelledCount: 0, cancelRate: 0, completedCount: 0, completionRate: 0, trend: "stable" };

  try {
    const since = new Date(Date.now() - days * 86_400_000);
    const midpoint = new Date(Date.now() - (days / 2) * 86_400_000);

    const [overall] = await d
      .select({
        total: sql<number>`count(*)`,
        cancelled: sql<number>`sum(case when status = 'cancelled' then 1 else 0 end)`,
        completed: sql<number>`sum(case when status = 'completed' then 1 else 0 end)`,
      })
      .from(bookings)
      .where(gte(bookings.createdAt, since));

    const [firstHalf] = await d
      .select({
        total: sql<number>`count(*)`,
        cancelled: sql<number>`sum(case when status = 'cancelled' then 1 else 0 end)`,
      })
      .from(bookings)
      .where(and(gte(bookings.createdAt, since), sql`${bookings.createdAt} < ${midpoint}`));

    const [secondHalf] = await d
      .select({
        total: sql<number>`count(*)`,
        cancelled: sql<number>`sum(case when status = 'cancelled' then 1 else 0 end)`,
      })
      .from(bookings)
      .where(gte(bookings.createdAt, midpoint));

    const total = Number(overall?.total ?? 0);
    const cancelled = Number(overall?.cancelled ?? 0);
    const completed = Number(overall?.completed ?? 0);

    const firstCancelRate = firstHalf?.total ? Number(firstHalf.cancelled) / Number(firstHalf.total) : 0;
    const secondCancelRate = secondHalf?.total ? Number(secondHalf.cancelled) / Number(secondHalf.total) : 0;

    let trend: "improving" | "worsening" | "stable";
    const delta = secondCancelRate - firstCancelRate;
    if (delta < -0.05) trend = "improving";
    else if (delta > 0.05) trend = "worsening";
    else trend = "stable";

    return {
      totalBookings: total,
      cancelledCount: cancelled,
      cancelRate: total > 0 ? cancelled / total : 0,
      completedCount: completed,
      completionRate: total > 0 ? completed / total : 0,
      trend,
    };
  } catch (err) {
    log.warn("getNoShowStats failed", { error: err instanceof Error ? err.message : String(err) });
    return { totalBookings: 0, cancelledCount: 0, cancelRate: 0, completedCount: 0, completionRate: 0, trend: "stable" };
  }
}
