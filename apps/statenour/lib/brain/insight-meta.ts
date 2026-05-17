/**
 * Shared insight metadata — Bayesian confidence + Lindy half-life
 * + falsifiability + evidence count.
 *
 * Threading principle: every brain finding (blind-spot, correlation,
 * wisdom, teaching-moment, counter-intuitive, attention) carries the
 * SAME calibration shape. That makes downstream consumers (system
 * prompt, /system/brain, Nick replies) able to rank, weight, and
 * decay findings consistently.
 *
 * Sources behind the design:
 *   · Bayes (1763) — posterior = prior × likelihood / evidence.
 *     Each new observation updates confidence rather than replaces.
 *   · Mandelbrot/Taleb (1990s) Lindy — non-perishable things have
 *     life expectancy proportional to their current age. Older,
 *     stable findings get MORE weight, not less.
 *   · Popper (1934) falsifiability — claims that can't be wrong
 *     aren't useful claims. Every finding carries a "false-when"
 *     condition.
 *   · Ericsson (1993) deliberate practice — wisdom that's never
 *     violated isn't tested. Track violation rate as quality signal.
 */

export interface InsightMeta {
  /** 0-1 calibrated confidence after Bayesian updates. */
  confidence: number;
  /** Number of independent observations supporting this finding. */
  evidenceCount: number;
  /** Days since first observation. Lindy weight grows with age. */
  stabilityDays: number;
  /** Conservative half-life — after this many days WITHOUT
   *  reinforcement, confidence halves. Per-engine default below. */
  halfLifeDays: number;
  /** Popper-style falsification condition. Free-text describing
   *  "this finding is false when ...". Empty string flags an
   *  unfalsifiable claim — useful as a quality filter. */
  falseWhen: string;
  /** Number of times Nour ACTED against this insight after
   *  encountering it. High violation rate = the insight is the
   *  one most worth surfacing (Ericsson). */
  violationCount: number;
  /** Last time this finding was confirmed by new evidence. */
  lastConfirmedAt: string | null;
}

export const DEFAULT_HALF_LIFE_DAYS: Readonly<Record<string, number>> = {
  // Faster-decaying (situational): blind-spots, attention patterns
  blind_spot: 14,
  attention: 7,
  teaching_moment: 30,
  // Slower-decaying (durable): wisdom, counter-intuitive, correlations
  wisdom: 180,
  counter_intuitive: 60,
  correlation: 90,
};

export function defaultHalfLife(engineCategory: string): number {
  return DEFAULT_HALF_LIFE_DAYS[engineCategory] ?? 30;
}

export function makeMeta(opts: {
  confidence?: number;
  evidenceCount?: number;
  stabilityDays?: number;
  halfLifeDays?: number;
  falseWhen?: string;
  violationCount?: number;
  lastConfirmedAt?: string | null;
}): InsightMeta {
  return {
    confidence: opts.confidence ?? 0.5,
    evidenceCount: opts.evidenceCount ?? 1,
    stabilityDays: opts.stabilityDays ?? 0,
    halfLifeDays: opts.halfLifeDays ?? 30,
    falseWhen: opts.falseWhen ?? "",
    violationCount: opts.violationCount ?? 0,
    lastConfirmedAt: opts.lastConfirmedAt ?? new Date().toISOString(),
  };
}

/**
 * Bayesian update — posterior confidence after a new observation.
 * Logistic-additive scheme so confidence stays in (0, 1):
 *   Convert prior to log-odds, add ±k for confirming/contradicting,
 *   convert back. Bounded growth + bounded decay.
 *
 * @param prior 0-1 current confidence
 * @param confirms true=evidence supports, false=evidence contradicts
 * @param weight how much this observation moves confidence (default 0.4)
 */
export function bayesianUpdate(
  prior: number,
  confirms: boolean,
  weight = 0.4,
): number {
  const eps = 1e-6;
  const p = Math.max(eps, Math.min(1 - eps, prior));
  const logOdds = Math.log(p / (1 - p));
  const next = logOdds + (confirms ? weight : -weight);
  const post = 1 / (1 + Math.exp(-next));
  return Math.max(0, Math.min(1, post));
}

/**
 * Lindy decay — confidence weight given age + last confirmation.
 * Non-perishable findings (older, more stable) decay slower than
 * young ones. Mandelbrot/Taleb formalization.
 *
 * Returns a multiplier in [0, 1.5] applied to confidence:
 *   stability ramp: log(1 + days/30) — gentle growth with age
 *   decay penalty: exp(-daysSinceConfirm / halfLife)
 *   product = effective weight
 */
export function lindyWeight(
  stabilityDays: number,
  daysSinceConfirm: number,
  halfLifeDays: number,
): number {
  const stabilityBoost = 1 + Math.log10(1 + stabilityDays / 30) * 0.3;
  const decay = Math.exp(-Math.LN2 * (daysSinceConfirm / halfLifeDays));
  return Math.max(0, Math.min(1.5, stabilityBoost * decay));
}

/**
 * Effective confidence = raw confidence × Lindy weight.
 * This is the value engines should use for ranking + the system
 * prompt should use for "should I surface this?" thresholds.
 */
export function effectiveConfidence(
  meta: InsightMeta,
  nowIso: string = new Date().toISOString(),
): number {
  const last = meta.lastConfirmedAt
    ? new Date(meta.lastConfirmedAt).getTime()
    : Date.now();
  const daysSince = (Date.now() - last) / 86400_000;
  const w = lindyWeight(meta.stabilityDays, daysSince, meta.halfLifeDays);
  return Math.max(0, Math.min(1, meta.confidence * w));
}

/**
 * Quality filter: only surface findings that have:
 *   - effective confidence ≥ 0.4
 *   - falseWhen present (Popper guard against unfalsifiable claims)
 *
 * Engines use this as a default threshold for system-prompt
 * inclusion. Lower the bar in /brain explorer; raise it for HQ.
 */
export function shouldSurface(meta: InsightMeta, threshold = 0.4): boolean {
  if (!meta.falseWhen || meta.falseWhen.trim().length === 0) return false;
  return effectiveConfidence(meta) >= threshold;
}
