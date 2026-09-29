import { brierScore as binaryBrierScore } from "@/lib/brain/calibration";

export { binaryBrierScore };

export interface CategoricalCalibrationSample {
  probabilities: Record<string, number>;
  observed: string;
}

export interface CalibrationBin {
  lower: number;
  upper: number;
  count: number;
  meanConfidence: number | null;
  accuracy: number | null;
  gap: number | null;
}

/**
 * Normalized multiclass Brier score.
 *
 * The classic multiclass score sums squared error over K classes (range 0..2).
 * We divide by K so all decision schemas remain on a 0..1-ish comparable scale.
 * This is an internal reporting convention; raw benchmark claims from external
 * projects must not be compared without matching their convention.
 */
export function multiclassBrier(
  probabilities: Record<string, number>,
  observed: string,
): number | null {
  const entries = Object.entries(probabilities);
  if (entries.length < 2 || !(observed in probabilities)) return null;
  if (entries.some(([, p]) => !Number.isFinite(p) || p < 0 || p > 1)) return null;
  const total = entries.reduce((sum, [, p]) => sum + p, 0);
  if (Math.abs(total - 1) > 0.02) return null;

  const squared = entries.reduce((sum, [label, p]) => {
    const target = label === observed ? 1 : 0;
    return sum + (p - target) ** 2;
  }, 0);
  return squared / entries.length;
}

export function categoricalLogLoss(
  probabilities: Record<string, number>,
  observed: string,
): number | null {
  const p = probabilities[observed];
  if (p === undefined || !Number.isFinite(p) || p < 0 || p > 1) return null;
  return -Math.log(Math.max(p, 1e-12));
}

/**
 * Top-label ECE: bucket by the probability assigned to the selected class and
 * compare bucket confidence to empirical accuracy.
 */
export function expectedCalibrationError(
  samples: readonly CategoricalCalibrationSample[],
  bins = 10,
): { ece: number | null; bins: CalibrationBin[] } {
  const binCount = Math.max(2, Math.min(Math.floor(bins), 20));
  const buckets = Array.from({ length: binCount }, () => [] as Array<{
    confidence: number;
    correct: boolean;
  }>);

  for (const sample of samples) {
    const entries = Object.entries(sample.probabilities).filter(([, p]) =>
      Number.isFinite(p) && p >= 0 && p <= 1,
    );
    if (entries.length < 2 || !(sample.observed in sample.probabilities)) continue;
    const [selected, confidence] = entries.reduce((best, next) =>
      next[1] > best[1] ? next : best,
    );
    const index = Math.min(binCount - 1, Math.floor(confidence * binCount));
    buckets[index]!.push({ confidence, correct: selected === sample.observed });
  }

  const valid = buckets.reduce((sum, bucket) => sum + bucket.length, 0);

  const report: CalibrationBin[] = buckets.map((bucket, index) => {
    const lower = index / binCount;
    const upper = (index + 1) / binCount;
    if (bucket.length === 0) {
      return { lower, upper, count: 0, meanConfidence: null, accuracy: null, gap: null };
    }
    const meanConfidence =
      bucket.reduce((sum, item) => sum + item.confidence, 0) / bucket.length;
    const accuracy =
      bucket.filter((item) => item.correct).length / bucket.length;
    return {
      lower,
      upper,
      count: bucket.length,
      meanConfidence,
      accuracy,
      gap: Math.abs(meanConfidence - accuracy),
    };
  });

  if (valid === 0) return { ece: null, bins: report };

  const ece = report.reduce((sum, bin) => {
    if (bin.gap === null) return sum;
    return sum + (bin.count / valid) * bin.gap;
  }, 0);
  return { ece, bins: report };
}
