/**
 * lib/ai/vnext/truth/forecast-detector.ts · calibration lever, detection
 * half (2026-08-18).
 *
 * WHY — both instruments independently flag calibration as Nick's
 * weakest trait (backfill mean 6.03 across 203 replies; the live golden
 * set's only non-harvested flag). The failure shape is specific: the
 * operator asks for a forecast, Nick answers with a clean POINT
 * ESTIMATE ("expect ≈26 cars") and no likelihood band, no confidence —
 * the ODNI vocabulary from ESTIMATIVE_LIKELIHOOD exists in the prompt
 * and simply is not applied under load. Published evidence says more
 * prompting stays overconfident (arXiv 2509.25532 and lineage), so the
 * fix is a PIPELINE layer; this module decides WHEN it fires.
 *
 * PRECISION OVER RECALL, deliberately. A false positive appends a
 * calibration footer to a non-forecast (noise + a wasted cheap call);
 * a false negative is just the status quo. So detection requires an
 * explicit forecast-shaped ASK — not merely a percentage or a future
 * tense somewhere in the reply. parseEstimative (BDN-302) already
 * carries the business-metric guard: "revenue up 12%" is a measurement
 * and never counts as calibration.
 *
 * Pure: no I/O, no env, no clock.
 */

import { parseEstimative } from "@/lib/ai/vnext/truth/estimative";

/**
 * Forecast-shaped asks. Each alternative is anchored to a construction
 * that requests a PREDICTION, not a decision or a diagnosis:
 *   · "will we/I/it/they/you/the …"        (direct future question)
 *   · "going to hit/break/make/sell/top/clear …"
 *   · "what are the odds/chances" · "odds of" · "chance(s) of/we"
 *   · "estimate" / "forecast" / "predict" / "projection"
 *   · "break/hit/clear <number>"            (target-crossing asks)
 *
 * Deliberately absent: bare "do you think" (decision-seeking, routes to
 * the `decide` class), "should I" (advice), "what's causing" (diagnosis
 * — persona-calibration-single-cause is governed by the prompt rule,
 * not this layer).
 */
const FORECAST_ASK_RE =
  /\b(will\s+(we|i|it|they|you|the|this|that)\b|going\s+to\s+(hit|break|make|sell|top|clear)\b|what\s+are\s+the\s+(odds|chances)\b|odds\s+(of|on|that)\b|chances?\s+(of|that|we|i)\b|estimate\b|forecast\b|predict(ion)?\b|projection\b|(break|hit|clear)\s+\d)/i;

/** The sanctioned honest path — "don't know, need to check" replies. */
const DONT_KNOW_RE = /\b(don'?t\s+know|need\s+to\s+check|can'?t\s+know|no\s+way\s+to\s+know)\b/i;

/** Below this the reply is a stub/ack, not a forecast worth calibrating. */
const MIN_REPLY_LEN = 40;

export function isForecastAsk(userText: string): boolean {
  const t = (userText ?? "").trim();
  if (!t) return false;
  return FORECAST_ASK_RE.test(t);
}

export type CalibrationVerdict =
  | { needed: false; reason: "not-a-forecast-ask" | "already-calibrated" | "honest-dont-know" | "question-back" | "reply-too-short" }
  | { needed: true };

/**
 * Should the calibration layer act on this turn?
 *
 * `needed: true` means: the operator asked forecast-shaped, the reply
 * committed to a claim, and that claim carries NO scoreable likelihood
 * (no band, no qualifying percent, no tag) — the exact 2.4/10 failure
 * the golden set reproduces.
 */
export function needsCalibration(userText: string, replyText: string): CalibrationVerdict {
  if (!isForecastAsk(userText)) return { needed: false, reason: "not-a-forecast-ask" };

  const reply = (replyText ?? "").trim();
  if (reply.length < MIN_REPLY_LEN) return { needed: false, reason: "reply-too-short" };

  // A short reply that ends by asking the operator something is a
  // clarification, not a forecast — calibrating a question is noise.
  if (reply.length < 200 && reply.endsWith("?")) {
    return { needed: false, reason: "question-back" };
  }

  if (DONT_KNOW_RE.test(reply)) return { needed: false, reason: "honest-dont-know" };

  const reading = parseEstimative(reply);
  if (reading.likelihood !== null && reading.confidence !== null) {
    return { needed: false, reason: "already-calibrated" };
  }
  // Likelihood without confidence (or vice versa) still needs the
  // footer — BDN-302's whole point is that BOTH quantities get stated.
  if (reading.likelihood !== null && reading.confidence === null) return { needed: true };

  return { needed: true };
}
