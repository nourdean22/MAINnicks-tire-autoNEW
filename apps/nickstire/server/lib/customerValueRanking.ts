/**
 * Q-27 · Read-only customer value ranking.
 *
 * This is deliberately NOT a send list and NOT a revenue forecast. It applies
 * the CDNOW reference model to Nick's observed paid-visit histories only to
 * create an operator ranking. The fit is external, not shop-calibrated.
 */
import {
  customerValueRankingScore,
  type BgnbdParams,
  type GammaGammaParams,
} from "../../shared/customerValueModel";

export interface PaidVisitRow {
  customerId: number;
  invoiceDate: Date;
  totalAmount: number; // cents
  /**
   * The invoice's shop day as stored (`YYYY-MM-DD`). `invoiceDate` is stored in shop time, so the
   * reader takes the day from SQL; re-deriving it from the driver's Date in New York time put a
   * date-only ticket (stored at 00:00) on the day before, so it and a timed ticket of the same day
   * counted as two purchase periods. Without it the day comes from `invoiceDate` (tests, callers
   * holding true instants).
   */
  shopDay?: string;
}

export interface CustomerValueRank {
  customerId: number;
  purchaseDays: number;
  frequency: number;
  recencyWeeks: number;
  ageWeeks: number;
  repeatAverageCents: number;
  probabilityAlive: number;
  expectedPurchases13Weeks: number;
  expectedAverageValueCents: number;
  rankingScoreCents: number;
}

const WEEK_MS = 7 * 86_400_000;

function shopDay(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Pure aggregation + ranking. Multiple invoices on one shop day are one
 * purchase period, matching lifetimes' frequency-as-repeat-periods definition.
 */
export function rankCustomerValueHistories(
  rows: readonly PaidVisitRow[],
  now: Date,
  options?: {
    horizonWeeks?: number;
    bgnbd?: BgnbdParams;
    gammaGamma?: GammaGammaParams;
  },
): CustomerValueRank[] {
  const byCustomer = new Map<number, Map<string, { at: Date; cents: number }>>();
  for (const row of rows) {
    if (
      !Number.isFinite(row.customerId) ||
      !Number.isFinite(row.totalAmount) ||
      row.totalAmount <= 0 ||
      !Number.isFinite(row.invoiceDate.getTime()) ||
      row.invoiceDate > now
    ) continue;
    let days = byCustomer.get(row.customerId);
    if (!days) {
      days = new Map();
      byCustomer.set(row.customerId, days);
    }
    const day = row.shopDay ?? shopDay(row.invoiceDate);
    const existing = days.get(day);
    if (existing) existing.cents += row.totalAmount;
    else days.set(day, { at: row.invoiceDate, cents: row.totalAmount });
  }

  const horizonWeeks = options?.horizonWeeks ?? 13;
  const ranked: CustomerValueRank[] = [];
  for (const [customerId, dayMap] of byCustomer) {
    const visits = [...dayMap.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
    if (visits.length === 0) continue;
    const first = visits[0]!;
    const last = visits[visits.length - 1]!;
    const frequency = visits.length - 1;
    const recencyWeeks = Math.max(0, (last.at.getTime() - first.at.getTime()) / WEEK_MS);
    const ageWeeks = Math.max(recencyWeeks, (now.getTime() - first.at.getTime()) / WEEK_MS);
    const repeat = visits.slice(1);
    // Gamma-Gamma uses repeat purchase values. One-and-done has no personal
    // repeat-value evidence, so x=0 shrinks to the population mean.
    const repeatAverageCents =
      repeat.length === 0
        ? 0
        : repeat.reduce((sum, visit) => sum + visit.cents, 0) / repeat.length;
    // CDNOW Gamma-Gamma monetary parameters are in dollars. Nick's invoice
    // storage is integer cents, so convert into model units and convert the
    // resulting value/score back to cents. Mixing the units would silently
    // shrink the prior by 100x.
    const value = customerValueRankingScore({
      horizon: horizonWeeks,
      frequency,
      recency: recencyWeeks,
      T: ageWeeks,
      monetaryValue: repeatAverageCents / 100,
      bgnbd: options?.bgnbd,
      gammaGamma: options?.gammaGamma,
    });
    ranked.push({
      customerId,
      purchaseDays: visits.length,
      frequency,
      recencyWeeks,
      ageWeeks,
      repeatAverageCents,
      probabilityAlive: value.probabilityAlive,
      expectedPurchases13Weeks: value.expectedPurchases,
      expectedAverageValueCents: value.expectedAverageValue * 100,
      rankingScoreCents: value.score * 100,
    });
  }
  return ranked.sort((a, b) =>
    b.rankingScoreCents - a.rankingScoreCents || a.customerId - b.customerId
  );
}

export async function getCustomerValueReferenceRanking(
  limit = 25,
  now: Date = new Date(),
): Promise<{
  rankingOnly: true;
  calibration: "external-cdnow-reference-not-shop-fitted";
  horizonWeeks: 13;
  rows: CustomerValueRank[];
  measuredRows: number;
}> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) {
    return {
      rankingOnly: true,
      calibration: "external-cdnow-reference-not-shop-fitted",
      horizonWeeks: 13,
      rows: [],
      measuredRows: 0,
    };
  }
  const raw = await d.execute(sql.raw(
    "SELECT customerId, invoiceDate, DATE_FORMAT(invoiceDate, '%Y-%m-%d') AS shopDay, totalAmount FROM invoices " +
      "WHERE customerId IS NOT NULL AND invoiceDate IS NOT NULL " +
      "AND totalAmount > 0 AND paymentStatus = 'paid' " +
      "ORDER BY customerId ASC, invoiceDate ASC"
  ));
  const rows = (Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : raw) as Array<Record<string, unknown>>;
  const measured = rows
    .map((row) => ({
      customerId: Number(row.customerId),
      invoiceDate: new Date(String(row.invoiceDate)),
      totalAmount: Number(row.totalAmount),
      ...(typeof row.shopDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.shopDay) ? { shopDay: row.shopDay } : {}),
    }))
    .filter((row) =>
      Number.isFinite(row.customerId) &&
      Number.isFinite(row.invoiceDate.getTime()) &&
      Number.isFinite(row.totalAmount)
    );
  return {
    rankingOnly: true,
    calibration: "external-cdnow-reference-not-shop-fitted",
    horizonWeeks: 13,
    rows: rankCustomerValueHistories(measured, now).slice(0, Math.max(1, Math.min(100, limit))),
    measuredRows: measured.length,
  };
}
