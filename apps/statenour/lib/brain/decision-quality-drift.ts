/**
 * Decision-quality drift detector · v8.2 · F3 · Apr 29.
 *
 * Computes a rolling weekly grade-point-average (GPA) of Nour's
 * graded decisions and detects sustained drift — a 15%+ drop from
 * the prior 4-week average to the most recent week.
 *
 * Grade decoding (handles the common shapes Nour uses):
 *   "A+" / "A" / "A-"   → 4.0 / 4.0 / 3.7
 *   "B+" / "B" / "B-"   → 3.3 / 3.0 / 2.7
 *   "C+" / "C" / "C-"   → 2.3 / 2.0 / 1.7
 *   "D" / "D-"          → 1.0 / 0.7
 *   "F"                 → 0.0
 *   numeric "0"-"100"    → /25 (so 100 → 4.0)
 *   anything else       → ignored
 *
 * Storage:
 *   · Alert row in BrainMemory category=decision_quality_drift
 *     with idempotency_key from the week-ending-date so the cron
 *     can run hourly without spamming.
 *   · Alert content names the magnitude + direction.
 *
 * Hooked from /api/cron/decision-quality-drift (weekly, Sunday).
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/decision-quality-drift");

const GRADE_MAP: Record<string, number> = {
  "A+": 4.0,
  "A": 4.0,
  "A-": 3.7,
  "B+": 3.3,
  "B": 3.0,
  "B-": 2.7,
  "C+": 2.3,
  "C": 2.0,
  "C-": 1.7,
  "D+": 1.3,
  "D": 1.0,
  "D-": 0.7,
  "F": 0.0,
};

const ALERT_CATEGORY = "decision_quality_drift";
const DRIFT_THRESHOLD_PCT = 15;
const RECENT_WEEK_COUNT = 1;
const BASELINE_WEEK_COUNT = 4;

/** Convert a grade string into a 0-4 GPA. Returns null if unparseable. */
export function gradeToGpa(grade: string | null | undefined): number | null {
  if (grade == null) return null;
  const g = grade.trim().toUpperCase();
  if (g === "") return null; // empty string is not a grade
  if (g in GRADE_MAP) return GRADE_MAP[g];
  // Numeric percentage / score
  const n = Number(g);
  if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.min(4, n / 25);
  if (Number.isFinite(n) && n >= 0 && n <= 4) return n; // already a GPA
  return null;
}

interface DecisionRow {
  grade: string | null;
  date: string;
}

export interface DriftReport {
  computedAt: string;
  recentGpa: number | null;
  baselineGpa: number | null;
  deltaPct: number | null;
  trend: "up" | "down" | "flat" | "insufficient_data";
  /** True when recent < baseline by >= DRIFT_THRESHOLD_PCT. */
  drift: boolean;
  alertWritten: boolean;
  weekEndingDate: string;
  recentSampleSize: number;
  baselineSampleSize: number;
}

function weekStart(d: Date): Date {
  const r = new Date(d);
  r.setUTCHours(0, 0, 0, 0);
  // Monday = 1; back up to Monday.
  const day = r.getUTCDay();
  const back = (day + 6) % 7;
  r.setUTCDate(r.getUTCDate() - back);
  return r;
}

/** Compute mean ignoring null entries. Returns null on empty. */
function mean(xs: Array<number | null>): { mean: number | null; n: number } {
  const valid = xs.filter((x): x is number => x !== null);
  if (valid.length === 0) return { mean: null, n: 0 };
  return { mean: valid.reduce((a, b) => a + b, 0) / valid.length, n: valid.length };
}

export async function runDecisionQualityDrift(): Promise<DriftReport> {
  const computedAt = new Date().toISOString();
  const today = new Date();
  // Look back BASELINE_WEEK_COUNT + RECENT_WEEK_COUNT weeks worth of data.
  const horizonStart = new Date(today);
  horizonStart.setUTCDate(
    horizonStart.getUTCDate() - 7 * (BASELINE_WEEK_COUNT + RECENT_WEEK_COUNT) - 1,
  );

  const rows = (await prisma.masteryDecision.findMany({
    where: {
      grade: { not: null },
      deletedAt: null,
      date: { gte: horizonStart.toISOString().slice(0, 10) },
    },
    select: { grade: true, date: true },
    orderBy: { date: "asc" },
  })) as DecisionRow[];

  // Bucket each row into "recent" (this week) vs "baseline" (prior N).
  const thisWeekStart = weekStart(today);
  const baselineStart = new Date(thisWeekStart);
  baselineStart.setUTCDate(baselineStart.getUTCDate() - 7 * BASELINE_WEEK_COUNT);

  const recentGpas: Array<number | null> = [];
  const baselineGpas: Array<number | null> = [];

  for (const r of rows) {
    // v10.0.38 — force UTC interpretation. r.date is stored as a
    // YYYY-MM-DD string; bare `new Date(str)` interprets at LOCAL
    // midnight, which on EDT machines lands at 4am UTC same day
    // (still in bucket) but on UTC machines lands at 0:00 UTC same
    // day — and on a server in another zone could shift across the
    // bucket boundary. Anchoring at UTC midnight matches the
    // setUTCDate / getUTCDay used elsewhere in this function.
    const d = new Date(r.date + "T00:00:00Z");
    const gpa = gradeToGpa(r.grade);
    if (gpa === null) continue;
    if (d >= thisWeekStart) recentGpas.push(gpa);
    else if (d >= baselineStart) baselineGpas.push(gpa);
  }

  const recent = mean(recentGpas);
  const baseline = mean(baselineGpas);
  const weekEndingDate = today.toISOString().slice(0, 10);

  if (recent.mean === null || baseline.mean === null || baseline.n < 3) {
    return {
      computedAt,
      recentGpa: recent.mean,
      baselineGpa: baseline.mean,
      deltaPct: null,
      trend: "insufficient_data",
      drift: false,
      alertWritten: false,
      weekEndingDate,
      recentSampleSize: recent.n,
      baselineSampleSize: baseline.n,
    };
  }

  const deltaPct = ((recent.mean - baseline.mean) / baseline.mean) * 100;
  const drift = deltaPct <= -DRIFT_THRESHOLD_PCT;
  const trend: DriftReport["trend"] =
    Math.abs(deltaPct) < 3 ? "flat" : deltaPct > 0 ? "up" : "down";

  let alertWritten = false;
  if (drift) {
    // Dedup via the existing @@unique([category, key]) on brain_memories.
    // The week-ending-date IS the dedup key — P2002 means we already
    // wrote this week's drift alert.
    try {
      await prisma.brainMemory.create({
        data: {
          category: ALERT_CATEGORY,
          key: weekEndingDate,
          content: `Decision quality drift · this week's GPA ${recent.mean.toFixed(2)} vs prior 4-week ${baseline.mean.toFixed(2)} (${deltaPct.toFixed(1)}%). Sample: ${recent.n} recent / ${baseline.n} baseline.`,
          confidence: 0.9,
          source: "cron:decision-quality-drift",
          metadata: {
            recentGpa: recent.mean,
            baselineGpa: baseline.mean,
            deltaPct,
            recentSampleSize: recent.n,
            baselineSampleSize: baseline.n,
          } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
        },
      });
      alertWritten = true;
    } catch (err: unknown) {
      // P2002 = idempotency hit (already alerted for this week)
      if (!(err && typeof err === "object" && (err as { code?: string }).code === "P2002")) {
        log.warn("alert_write_failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return {
    computedAt,
    recentGpa: recent.mean,
    baselineGpa: baseline.mean,
    deltaPct,
    trend,
    drift,
    alertWritten,
    weekEndingDate,
    recentSampleSize: recent.n,
    baselineSampleSize: baseline.n,
  };
}
