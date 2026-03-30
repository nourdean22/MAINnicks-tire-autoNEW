/**
 * Revenue Prediction — Forecasts daily/weekly/monthly revenue
 * Uses historical booking + invoice data to predict future revenue.
 * Powers the admin dashboard revenue forecast widget.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("revenue-prediction");

export interface RevenueSnapshot {
  date: string;
  amount: number;
  orderCount: number;
}

export interface RevenueForecast {
  period: "daily" | "weekly" | "monthly";
  predicted: number;
  confidence: number; // 0-1
  trend: "up" | "down" | "flat";
  trendPercent: number;
  basedOnDays: number;
  breakdown: {
    avgDailyRevenue: number;
    bestDay: { day: string; amount: number };
    worstDay: { day: string; amount: number };
    avgOrderValue: number;
    avgDailyOrders: number;
  };
}

/** Predict revenue for the next period based on historical data */
export function predictRevenue(
  history: RevenueSnapshot[],
  period: "daily" | "weekly" | "monthly" = "weekly"
): RevenueForecast {
  if (history.length < 7) {
    return {
      period,
      predicted: 0,
      confidence: 0,
      trend: "flat",
      trendPercent: 0,
      basedOnDays: history.length,
      breakdown: {
        avgDailyRevenue: 0,
        bestDay: { day: "N/A", amount: 0 },
        worstDay: { day: "N/A", amount: 0 },
        avgOrderValue: 0,
        avgDailyOrders: 0,
      },
    };
  }

  // Sort by date
  const sorted = [...history].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Calculate daily averages
  const totalRevenue = sorted.reduce((s, d) => s + d.amount, 0);
  const totalOrders = sorted.reduce((s, d) => s + d.orderCount, 0);
  const avgDailyRevenue = totalRevenue / sorted.length;
  const avgDailyOrders = totalOrders / sorted.length;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Best and worst days
  const best = sorted.reduce((max, d) => (d.amount > max.amount ? d : max), sorted[0]);
  const worst = sorted.reduce((min, d) => (d.amount < min.amount ? d : min), sorted[0]);

  // Trend: compare recent 7 days to prior 7 days
  const recentDays = sorted.slice(-7);
  const priorDays = sorted.slice(-14, -7);
  const recentAvg =
    recentDays.reduce((s, d) => s + d.amount, 0) / recentDays.length;
  const priorAvg =
    priorDays.length > 0
      ? priorDays.reduce((s, d) => s + d.amount, 0) / priorDays.length
      : recentAvg;

  const trendPercent =
    priorAvg > 0
      ? Math.round(((recentAvg - priorAvg) / priorAvg) * 100)
      : 0;

  const trend: "up" | "down" | "flat" =
    trendPercent > 5 ? "up" : trendPercent < -5 ? "down" : "flat";

  // Prediction based on weighted recent average
  const weightedAvg = recentAvg * 0.7 + avgDailyRevenue * 0.3;

  const multiplier = period === "daily" ? 1 : period === "weekly" ? 7 : 30;
  const predicted = Math.round(weightedAvg * multiplier);

  // Confidence based on data volume and variance
  const variance =
    sorted.reduce((s, d) => s + Math.pow(d.amount - avgDailyRevenue, 2), 0) /
    sorted.length;
  const cv = avgDailyRevenue > 0 ? Math.sqrt(variance) / avgDailyRevenue : 1;
  const dataConfidence = Math.min(sorted.length / 30, 1); // More data = higher confidence
  const varianceConfidence = Math.max(1 - cv, 0.2); // Lower variance = higher confidence
  const confidence =
    Math.round(dataConfidence * varianceConfidence * 100) / 100;

  log.info("Revenue prediction generated", {
    period,
    predicted,
    confidence,
    trend,
    basedOnDays: sorted.length,
  });

  return {
    period,
    predicted,
    confidence,
    trend,
    trendPercent,
    basedOnDays: sorted.length,
    breakdown: {
      avgDailyRevenue: Math.round(avgDailyRevenue),
      bestDay: { day: best.date, amount: best.amount },
      worstDay: { day: worst.date, amount: worst.amount },
      avgOrderValue: Math.round(avgOrderValue),
      avgDailyOrders: Math.round(avgDailyOrders * 10) / 10,
    },
  };
}

/** Detect revenue anomalies (unusually high or low days) */
export function detectRevenueAnomalies(
  history: RevenueSnapshot[]
): Array<{ date: string; amount: number; type: "spike" | "drop"; deviation: number }> {
  if (history.length < 14) return [];

  const amounts = history.map((d) => d.amount);
  const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
  const stdDev = Math.sqrt(
    amounts.reduce((s, a) => s + Math.pow(a - mean, 2), 0) / amounts.length
  );

  if (stdDev === 0) return [];

  return history
    .map((d) => {
      const deviation = (d.amount - mean) / stdDev;
      if (Math.abs(deviation) > 2) {
        return {
          date: d.date,
          amount: d.amount,
          type: (deviation > 0 ? "spike" : "drop") as "spike" | "drop",
          deviation: Math.round(deviation * 10) / 10,
        };
      }
      return null;
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);
}
