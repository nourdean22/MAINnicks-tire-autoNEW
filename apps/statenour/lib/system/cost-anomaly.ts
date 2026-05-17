/**
 * AI cost anomaly detector · v10.0.91 · 2026-05-02.
 *
 * Computes z-score on today's AI cost vs the trailing 7-day baseline
 * (excluding today). Fires alert when |z| > 2.0 — that's the
 * statistical "interesting" threshold (95% CI breach).
 *
 * Why: silent runaway AI cost is one of the most expensive failure
 * modes. A bad prompt loop or model upgrade can 10× spend overnight.
 * This catches it before the bill arrives.
 *
 * Output: BrainMemory category=cost_anomaly_alert when triggered.
 * alert-telegram-push picks it up next sweep (15 min cadence).
 */

import { prisma } from "@/lib/prisma";

export interface CostAnomalyReport {
  ranAt: string;
  todayCents: number;
  baselineMean: number;
  baselineStdDev: number;
  baselineDays: number;
  zScore: number | null;
  spike: boolean;
  trough: boolean;
  /** "anomalous" when |z| > 2 */
  status: "normal" | "spike" | "trough" | "insufficient_data";
  topByModel?: Array<{ model: string; cents: number; calls: number }>;
}

const Z_THRESHOLD = 2.0;
const MIN_BASELINE_DAYS = 3; // need >=3 days of history to compute meaningful std

export async function detectCostAnomaly(): Promise<CostAnomalyReport> {
  const ranAt = new Date().toISOString();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenAgo = new Date(todayStart.getTime() - 7 * 86_400_000);

  // Pull per-day cost totals for the last 8 days
  const rows = await prisma
    .$queryRawUnsafe<Array<{ day: string; cents: number; calls: number }>>(
      `SELECT
         to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
         COALESCE(SUM(cost_cents), 0)::int AS cents,
         COUNT(*)::int AS calls
       FROM ai_generations
       WHERE created_at >= $1
       GROUP BY 1
       ORDER BY 1 ASC`,
      sevenAgo.toISOString(),
    )
    .catch(() => []);

  if (rows.length === 0) {
    return {
      ranAt,
      todayCents: 0,
      baselineMean: 0,
      baselineStdDev: 0,
      baselineDays: 0,
      zScore: null,
      spike: false,
      trough: false,
      status: "insufficient_data",
    };
  }

  const todayKey = now.toISOString().slice(0, 10);
  const today = rows.find((r) => r.day === todayKey);
  const baseline = rows.filter((r) => r.day !== todayKey);
  const todayCents = today?.cents ?? 0;

  if (baseline.length < MIN_BASELINE_DAYS) {
    return {
      ranAt,
      todayCents,
      baselineMean: 0,
      baselineStdDev: 0,
      baselineDays: baseline.length,
      zScore: null,
      spike: false,
      trough: false,
      status: "insufficient_data",
    };
  }

  const mean =
    baseline.reduce((s, r) => s + r.cents, 0) / baseline.length;
  const variance =
    baseline.reduce((s, r) => s + (r.cents - mean) ** 2, 0) / baseline.length;
  const stdDev = Math.sqrt(variance);
  const zScore = stdDev === 0 ? 0 : (todayCents - mean) / stdDev;

  const spike = zScore > Z_THRESHOLD;
  const trough = zScore < -Z_THRESHOLD;
  const status = spike
    ? "spike"
    : trough
      ? "trough"
      : "normal";

  // If anomaly, pull top-by-model breakdown for the alert
  let topByModel: CostAnomalyReport["topByModel"];
  if (spike || trough) {
    const modelRows = await prisma
      .$queryRawUnsafe<
        Array<{ model: string; cents: number; calls: number }>
      >(
        `SELECT COALESCE(model, 'unknown')::text AS model,
                COALESCE(SUM(cost_cents), 0)::int AS cents,
                COUNT(*)::int AS calls
         FROM ai_generations
         WHERE created_at >= $1
         GROUP BY model
         ORDER BY cents DESC
         LIMIT 5`,
        todayStart.toISOString(),
      )
      .catch(() => []);
    topByModel = modelRows;
  }

  // Persist as alert when anomalous (idempotent per day per direction)
  if (spike || trough) {
    const direction = spike ? "spike" : "trough";
    const dayKey = now.toISOString().slice(0, 10);
    const markerKey = `${direction}__${dayKey}`;
    await prisma.brainMemory
      .upsert({
        where: {
          category_key: { category: "cost_anomaly_alert", key: markerKey },
        },
        create: {
          category: "cost_anomaly_alert",
          key: markerKey,
          content: `AI cost ${direction}: today ${todayCents}¢ vs baseline ${mean.toFixed(0)}¢ ± ${stdDev.toFixed(0)}¢ (z=${zScore.toFixed(2)})${topByModel ? `\nTop model: ${topByModel[0]?.model} = ${topByModel[0]?.cents}¢` : ""}`,
          confidence: 1.0,
          source: "lib:cost-anomaly",
          metadata: {
            todayCents,
            baselineMean: Math.round(mean * 100) / 100,
            baselineStdDev: Math.round(stdDev * 100) / 100,
            zScore: Math.round(zScore * 100) / 100,
            topByModel,
          },
        },
        update: {
          content: `AI cost ${direction}: today ${todayCents}¢ vs baseline ${mean.toFixed(0)}¢ ± ${stdDev.toFixed(0)}¢ (z=${zScore.toFixed(2)})`,
          metadata: {
            todayCents,
            baselineMean: Math.round(mean * 100) / 100,
            baselineStdDev: Math.round(stdDev * 100) / 100,
            zScore: Math.round(zScore * 100) / 100,
            topByModel,
          },
        },
      })
      .catch(() => {});
  }

  return {
    ranAt,
    todayCents,
    baselineMean: Math.round(mean * 100) / 100,
    baselineStdDev: Math.round(stdDev * 100) / 100,
    baselineDays: baseline.length,
    zScore: Math.round(zScore * 100) / 100,
    spike,
    trough,
    status,
    topByModel,
  };
}
