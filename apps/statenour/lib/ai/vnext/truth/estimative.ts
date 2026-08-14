/**
 * NICK VNEXT · estimative-language reader (BDN-302, 2026-08-14).
 *
 * The prompt half of BDN-302 lives in
 * lib/ai/prompt/policy/operator-rules.ts (ESTIMATIVE_LIKELIHOOD +
 * ANALYTIC_CONFIDENCE). This is the reader for it.
 *
 * WHY THIS EXISTS
 * BDN-106 shipped a Brier-score calibration report on 2026-08-12 that
 * honestly reported n=0. It was not waiting on time or on data — it was
 * waiting on a VOCABULARY. A Brier score scores a PROBABILITY against a
 * binary outcome, and the old CONFIDENCE_CUES rule emitted a blended
 * hedge word ("Best guess:") that carries no probability at all. The
 * instrument could not see its target.
 *
 * This module turns Nick's replies back into two separable numbers:
 *   likelihood  — probability of the event (Brier-scorable)
 *   confidence  — strength of the evidence base (NOT scorable; it is a
 *                 statement about the evidence, not about the world)
 *
 * Keeping those apart is the whole point. Averaging them, or scoring
 * confidence with a Brier, would silently recreate the original defect.
 *
 * Bands are the ODNI seven-point scale so the mapping is citable rather
 * than house-invented. Each band maps to its MIDPOINT for scoring; the
 * band's range is retained so a caller can report the honest interval
 * instead of pretending the midpoint was stated.
 *
 * Pure: no I/O, no async, no env, no clock. Same input, same output.
 */

export type ConfidenceLevel = "high" | "moderate" | "low";

export interface EstimativeBand {
  /** Canonical band label, ODNI seven-point scale. */
  readonly label: string;
  /** Inclusive lower bound, 0..1. */
  readonly low: number;
  /** Inclusive upper bound, 0..1. */
  readonly high: number;
  /** Midpoint — the value a Brier score should consume. */
  readonly mid: number;
}

export interface EstimativeReading {
  /** Probability 0..1 for scoring, or null when the text stated none. */
  likelihood: number | null;
  /** The band the text matched, when it used band language. */
  band: EstimativeBand | null;
  /** Evidence strength. Independent of likelihood — never averaged in. */
  confidence: ConfidenceLevel | null;
  /** True when an explicit numeric percentage was written. */
  explicitPercent: boolean;
  /** True when the compact `[~30% · conf: high]` tail tag was present. */
  tagged: boolean;
  /**
   * True when the text hedged WITHOUT giving a band or a percent — the
   * exact pre-BDN-302 behavior. This is the compliance signal: it is how
   * we measure whether the split rule is actually landing, per lane.
   */
  bareHedge: boolean;
}

/**
 * ODNI seven-point scale. ORDER IS LOAD-BEARING: matching walks this
 * array in sequence and takes the first hit, so every multi-word band
 * MUST precede the shorter band it contains ("very unlikely" before
 * "unlikely", "almost certain" before "certain"). BDN-103 shipped a
 * latent bug of exactly this shape — an unordered `find(startsWith)`
 * over route keys where a `/` entry would have swallowed every route.
 * Same failure class; do not re-sort this array alphabetically.
 */
export const ESTIMATIVE_BANDS: readonly EstimativeBand[] = [
  { label: "almost no chance", low: 0.01, high: 0.05, mid: 0.03 },
  { label: "very unlikely", low: 0.05, high: 0.2, mid: 0.125 },
  { label: "highly improbable", low: 0.05, high: 0.2, mid: 0.125 },
  { label: "roughly even chance", low: 0.45, high: 0.55, mid: 0.5 },
  { label: "even chance", low: 0.45, high: 0.55, mid: 0.5 },
  { label: "very likely", low: 0.8, high: 0.95, mid: 0.875 },
  { label: "highly probable", low: 0.8, high: 0.95, mid: 0.875 },
  { label: "almost certain", low: 0.95, high: 0.99, mid: 0.97 },
  { label: "nearly certain", low: 0.95, high: 0.99, mid: 0.97 },
  { label: "unlikely", low: 0.2, high: 0.45, mid: 0.325 },
  { label: "improbable", low: 0.2, high: 0.45, mid: 0.325 },
  { label: "likely", low: 0.55, high: 0.8, mid: 0.675 },
  { label: "probable", low: 0.55, high: 0.8, mid: 0.675 },
] as const;

/**
 * Hedges that carry NO probability. Matching one of these while no band
 * and no percent is present is what `bareHedge` reports. "probably" is
 * deliberately absent — it is the adverb form of the `probable` band and
 * is caught as a band, not as a bare hedge.
 */
const BARE_HEDGE_RE =
  /\b(best guess|if i had to bet|my hunch|i'?d guess|gut says|hard to say|could go either way)\b/i;

/** Compact tail tag: `[~30% · conf: high]`. Separator is permissive. */
const TAG_RE =
  /\[\s*~?\s*(\d{1,3}(?:\.\d+)?)\s*%\s*[·|,;\-\s]+\s*conf(?:idence)?\s*[:=]?\s*(high|moderate|medium|low)\s*\]/i;

/** A bare percentage anywhere in the text, e.g. "about a 30% chance". */
const PERCENT_RE = /(\d{1,3}(?:\.\d+)?)\s*%/;

/**
 * Estimative context required before a BARE percentage counts as a
 * likelihood.
 *
 * Self-review catch (2026-08-14): without this gate, "Revenue up 12%
 * last month" parsed as a 12% probability. Nick's replies are dense
 * with percentages that are measurements, not forecasts — margin,
 * growth, utilization — and every one of them would have been fed to
 * the Brier as a phantom forecast. A calibration instrument poisoned by
 * business metrics is worse than no instrument, because the resulting
 * score looks legitimate.
 *
 * A percentage inside the explicit tag needs no cue: the tag IS the
 * declaration. A band word also qualifies on its own.
 */
const ESTIMATIVE_CUE_RE =
  /\b(chance|chances|odds|probability|likelihood|confidence|i'?d bet|betting|risk of|shot at|coin flip)\b/i;

/** Prose confidence, e.g. "confidence: low" or "low confidence". */
const CONFIDENCE_PROSE_RE =
  /\b(?:conf(?:idence)?\s*[:=]\s*(high|moderate|medium|low)|(high|moderate|medium|low)\s+confidence)\b/i;

function normalizeConfidence(raw: string | undefined): ConfidenceLevel | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v === "high") return "high";
  if (v === "low") return "low";
  // "medium" is accepted on input and normalized — the prompt says
  // "moderate", but models drift to "medium" and dropping those rows
  // would understate compliance.
  if (v === "moderate" || v === "medium") return "moderate";
  return null;
}

function clampProbability(pct: number): number | null {
  if (!Number.isFinite(pct)) return null;
  if (pct < 0 || pct > 100) return null;
  return pct / 100;
}

function matchBand(text: string): EstimativeBand | null {
  const lower = text.toLowerCase();
  for (const band of ESTIMATIVE_BANDS) {
    if (lower.includes(band.label)) return band;
  }
  return null;
}

/**
 * Read likelihood + confidence out of a Nick reply.
 *
 * Precedence for likelihood: the explicit tag, then any bare percentage,
 * then band language. An explicit number always beats a band midpoint —
 * the midpoint is an inference we make, the number is what was said.
 */
export function parseEstimative(text: string): EstimativeReading {
  const input = text ?? "";

  const tagMatch = TAG_RE.exec(input);
  if (tagMatch) {
    const likelihood = clampProbability(Number.parseFloat(tagMatch[1]));
    return {
      likelihood,
      band: matchBand(input),
      confidence: normalizeConfidence(tagMatch[2]),
      explicitPercent: likelihood !== null,
      tagged: true,
      bareHedge: false,
    };
  }

  const confidence = normalizeConfidence(
    (() => {
      const m = CONFIDENCE_PROSE_RE.exec(input);
      return m ? (m[1] ?? m[2]) : undefined;
    })(),
  );

  const band = matchBand(input);

  // A bare percentage only counts as a forecast when the sentence is
  // actually making one — a band word or an estimative cue. Otherwise
  // it is a business metric and must not reach the Brier.
  const percentQualifies = band !== null || ESTIMATIVE_CUE_RE.test(input);
  const percentMatch = percentQualifies ? PERCENT_RE.exec(input) : null;
  const percentValue = percentMatch
    ? clampProbability(Number.parseFloat(percentMatch[1]))
    : null;

  const likelihood = percentValue ?? band?.mid ?? null;

  return {
    likelihood,
    band,
    confidence,
    explicitPercent: percentValue !== null,
    tagged: false,
    bareHedge: likelihood === null && BARE_HEDGE_RE.test(input),
  };
}

/**
 * Brier score for a single forecast. Lower is better; 0 is perfect.
 *
 * Deliberately takes ONLY the likelihood. Confidence is not scoreable
 * here and passing it in would rebuild the exact conflation BDN-302
 * exists to remove.
 *
 * Returns null when there is nothing to score, so an unstated estimate
 * is recorded as "not graded" rather than silently counted as a miss —
 * the BDN-105 lesson, where rows that never reached the gate were being
 * dropped and made a never-run process look adequately sampled.
 */
export function brierScore(
  likelihood: number | null,
  outcome: boolean | null,
): number | null {
  if (likelihood === null || outcome === null) return null;
  if (likelihood < 0 || likelihood > 1) return null;
  const actual = outcome ? 1 : 0;
  return (likelihood - actual) ** 2;
}

export interface EstimativeComplianceSummary {
  /** Replies examined. */
  total: number;
  /** Replies that stated a scoreable likelihood. */
  withLikelihood: number;
  /** Replies that stated a confidence level. */
  withConfidence: number;
  /** Replies carrying the compact machine-readable tag. */
  tagged: number;
  /** Replies that hedged with no band and no percent (the old behavior). */
  bareHedges: number;
}

/**
 * Compliance census over a batch of replies. This is the instrument that
 * answers "is the split rule actually landing?" — and, when the caller
 * groups by lane first, "is it landing on BOTH lanes?" That per-lane
 * reading is the open question from BDN-301: an identical prompt is not
 * an identical behavior across models.
 */
export function summarizeEstimativeCompliance(
  texts: readonly string[],
): EstimativeComplianceSummary {
  const summary: EstimativeComplianceSummary = {
    total: texts.length,
    withLikelihood: 0,
    withConfidence: 0,
    tagged: 0,
    bareHedges: 0,
  };
  for (const t of texts) {
    const r = parseEstimative(t);
    if (r.likelihood !== null) summary.withLikelihood++;
    if (r.confidence !== null) summary.withConfidence++;
    if (r.tagged) summary.tagged++;
    if (r.bareHedge) summary.bareHedges++;
  }
  return summary;
}
