/**
 * Forecast calibration · v10.0.150 · May 03 · Slice #3+4 of post-audit
 * consolidation.
 *
 * Per the audit recommendation: hit-rate alone isn't a meaningful
 * signal. "12 predictions, 6 landed = 50% hit" tells you nothing
 * about whether Nick's 70% confidence was actually 70%. Proper
 * scoring rules (Brier for binary, calibration plot for distribution
 * over confidence) reward honest uncertainty.
 *
 * This module is the math layer. The schema field `Prediction.brierScore`
 * is populated by outcome-tracker at resolution time. The helpers
 * here aggregate those scores into a calibration view that the
 * SignalZone forecast source consumes.
 *
 * Per kaizen + JIT: only binary scoring is implemented. Continuous
 * + interval predictions need CRPS, but the system has zero of those
 * today. Add CRPS when the first continuous Prediction lands.
 *
 * Reference: Brier (1950) "Verification of forecasts expressed in
 * terms of probability." Mon. Wea. Rev. 78(1).
 */

import { prisma } from "@/lib/prisma";

/**
 * Compute the Brier score for a single resolved binary prediction.
 *
 * Brier = (confidence - outcome)²
 *   confidence ∈ [0, 1]   (Nick's stated probability)
 *   outcome ∈ {0, 1}      (1 = confirmed, 0 = disproven)
 *
 * Properties:
 *   · 0 = perfect (Nick said 1.0 and it landed, or said 0.0 and it didn't)
 *   · 0.25 = 50/50 guess on either outcome
 *   · 1.0 = maximum miss (Nick said 1.0 and it disconfirmed)
 *
 * Lower is better. The naive baseline (always predict 0.5) yields
 * brier = 0.25, so any honest forecaster should beat that average.
 */
export function brierScore(confidence: number, outcome: 0 | 1): number {
  return (confidence - outcome) ** 2;
}

/**
 * Calibration bucket — predictions are grouped into 10% confidence
 * bands. For each band, the operator wants to see the actual hit rate.
 * A perfectly-calibrated forecaster has band.hitRate ≈ band.midpoint
 * for every band with enough samples.
 */
export interface CalibrationBucket {
  /** Lower bound of the confidence band, inclusive: 0.5, 0.6, 0.7, … */
  lower: number;
  /** Upper bound, exclusive: 0.6, 0.7, … (1.05 for the top band so 1.0 lands in it) */
  upper: number;
  /** Midpoint Nick claimed — what hitRate should equal if calibrated */
  midpoint: number;
  /** Resolved predictions in this band */
  count: number;
  /** Of those, how many were confirmed */
  confirmed: number;
  /** confirmed / count, or null if count < 2 (too few to read) */
  hitRate: number | null;
  /** Mean Brier across this band — lower is better */
  meanBrier: number | null;
}

const BAND_EDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.05] as const;

/**
 * Bucket a list of resolved predictions into 10 calibration bands.
 *
 * Input rows must have brierScore + confidence + status populated.
 * Pending predictions are silently skipped (they have no outcome yet).
 *
 * Pure function — no DB. Caller fetches the rows and passes them in,
 * which keeps this module trivially testable.
 */
export function bucketCalibration(
  rows: Array<{
    confidence: number;
    status: string;
    brierScore: number | null;
  }>,
): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < BAND_EDGES.length - 1; i++) {
    const lower = BAND_EDGES[i];
    const upper = BAND_EDGES[i + 1];
    const inBand = rows.filter(
      (r) =>
        r.confidence >= lower &&
        r.confidence < upper &&
        (r.status === "confirmed" || r.status === "disproven"),
    );
    const confirmed = inBand.filter((r) => r.status === "confirmed").length;
    const briers = inBand
      .map((r) => r.brierScore)
      .filter((b): b is number => b !== null);
    buckets.push({
      lower,
      upper,
      midpoint: (lower + Math.min(upper, 1)) / 2,
      count: inBand.length,
      confirmed,
      hitRate: inBand.length >= 2 ? confirmed / inBand.length : null,
      meanBrier:
        briers.length > 0
          ? briers.reduce((a, b) => a + b, 0) / briers.length
          : null,
    });
  }
  return buckets;
}

/**
 * Top-line calibration health for a window of resolved binary
 * predictions. Used by the SignalZone forecast source so the
 * candidate is diagnostic, not throughput-only.
 */
export interface CalibrationSummary {
  /** Binary predictions RESOLVED inside the window (keyed on `updatedAt`) */
  resolved: number;
  /** Confirmed of those */
  confirmed: number;
  /** Naive hit rate confirmed/resolved (or null if resolved < 2) */
  hitRate: number | null;
  /** Mean Brier across all resolved (lower is better; null if none) */
  meanBrier: number | null;
  /** "well-calibrated" / "drift" / "unknown" — operator-readable verdict */
  verdict: "well-calibrated" | "drift" | "unknown";
  /** How far the average claim was from the actual hit rate (e.g. 0.18 = 18 points off) */
  avgClaimVsRealityGap: number | null;
}

/**
 * Pull binary predictions RESOLVED in the last `days` days and roll them
 * up into a calibration summary.
 *
 * 2026-09-02 - the window was `createdAt: { gte: since }` AND
 * `status: { in: ["confirmed", "disproven"] }`, which required a row to
 * have been MADE inside the window and to be resolved already. That makes
 * the horizon shorter than the window BY CONSTRUCTION: at days=30 no
 * prediction with a 30-day-or-longer horizon could ever appear, so
 * "Calibration - 30d" was a statement about short-horizon forecasts wearing
 * the label of the brain's calibration, and a long-horizon prediction
 * resolved yesterday never moved it.
 *
 * The window now keys on `updatedAt`, so the population is "resolved in the
 * window" regardless of when it was made -- which is what every consumer's
 * label already claims. Prediction has no `resolvedAt` column; `updatedAt`
 * is written when outcome-tracker flips `status`, so it is the closest
 * available proxy, and it is indexed (`@@index([updatedAt])` in
 * prisma/schema.prisma) so this stays an index range scan. The known
 * imprecision: a resolved row edited again later re-enters the window.
 * That is a documented approximation, not a structural exclusion.
 *
 * THROWS on read failure. It used to swallow the error into `[]`, which the
 * empty branch below then reported as `resolved: 0, verdict: "unknown"` --
 * identical to a genuinely quiet window. Callers could not tell "no
 * predictions resolved" from "the database did not answer", and the /brain
 * tile hid itself for both. Callers now choose: `lib/services/
 * ultron-situation.ts` keeps its own `.catch()` (a digest may degrade), and
 * the tRPC procedure lets it propagate so the UI can say state unknown.
 */
export async function summarizeCalibration(opts: {
  days?: number;
}): Promise<CalibrationSummary> {
  const since = new Date(Date.now() - (opts.days ?? 7) * 86400_000);
  const rows = await prisma.prediction.findMany({
    where: {
      kind: "binary",
      status: { in: ["confirmed", "disproven"] },
      updatedAt: { gte: since },
    },
    select: { confidence: true, status: true, brierScore: true },
  });

  if (rows.length === 0) {
    return {
      resolved: 0,
      confirmed: 0,
      hitRate: null,
      meanBrier: null,
      verdict: "unknown",
      avgClaimVsRealityGap: null,
    };
  }

  const confirmed = rows.filter((r) => r.status === "confirmed").length;
  const hitRate = rows.length >= 2 ? confirmed / rows.length : null;
  const briers = rows
    .map((r) => r.brierScore)
    .filter((b): b is number => b !== null);
  const meanBrier =
    briers.length > 0 ? briers.reduce((a, b) => a + b, 0) / briers.length : null;

  // Average claimed confidence vs actual hit rate. If Nick averages
  // 0.78 but only 0.55 land, the gap is 0.23 — a clear signal of drift.
  const avgClaim =
    rows.reduce((acc, r) => acc + r.confidence, 0) / rows.length;
  const avgClaimVsRealityGap =
    hitRate !== null ? Math.abs(avgClaim - hitRate) : null;

  // Verdict heuristic — needs at least 4 resolved before we declare
  // a verdict. Below that, "unknown" is the honest answer.
  let verdict: CalibrationSummary["verdict"] = "unknown";
  if (rows.length >= 4 && avgClaimVsRealityGap !== null) {
    verdict = avgClaimVsRealityGap > 0.15 ? "drift" : "well-calibrated";
  }

  return {
    resolved: rows.length,
    confirmed,
    hitRate,
    meanBrier,
    verdict,
    avgClaimVsRealityGap,
  };
}
