/**
 * SERVICE-AFFINITY SCORING — the recalibrated cross-sell model (ROS-033).
 *
 * WHY THIS FILE EXISTS
 * `cross_sell` ran daily from May to July 2026, reported `completed` every time,
 * and sent zero messages. 25,550 predictions were written and the maximum
 * confidence ever recorded was **0.330** against a `>= 0.50` gate. The registry
 * warned explicitly against "fixing" that by lowering the gate — dropping it to
 * 0.25 would have delivered 6 sends. That warning was right, and the reason is
 * deeper than tuning:
 *
 *   1. THE MODEL WAS ADVERTISED AS FOUR SIGNALS AND IMPLEMENTED AS ONE.
 *      The design comment in `engines/customer.ts` describes
 *        score = α·vehicleAgeMileageDue + β·declinedRecall
 *              + γ·recencyDecay + δ·seasonalDemand − ε·alreadyHadRecently
 *      The code implemented γ (recency, 0-30 points), applied δ as a MULTIPLIER
 *      rather than a term, and used ε as a kill-switch. α and β were never
 *      written — and the query never even loaded the data they would need. A
 *      one-signal model cannot produce high confidence at any threshold, because
 *      there is nothing to add on top of the one signal.
 *
 *   2. CONFIDENCE WAS A PRODUCT OF TWO SUB-1 QUALITY MEASURES.
 *        confidence = min(1, totalInvoices/8) × min(1, score/45)
 *      Multiplying "how much do we know about this customer" by "how strong is
 *      the signal" is not a probability — it is systematically pessimistic. A
 *      genuinely good candidate with ordinary history is capped low by
 *      construction. 0.330 is the signature of that form: roughly 0.45 × 0.73.
 *
 * THE RECALIBRATION
 *   - Evidence sufficiency becomes a PRECONDITION, not a multiplier. Either we
 *     know enough about this customer to say anything, or we do not score them.
 *   - `confidence` is normalized signal strength alone, so the `>= 0.50` gate
 *     recovers its stated meaning ("more likely than not").
 *   - β · declinedRecall is IMPLEMENTED, and it is the strongest signal
 *     available anywhere in this business: the customer was handed a written
 *     estimate for this exact work and did not take it. `alg_estimates` carries
 *     it already (`matchedInvoiceId IS NULL` = never converted), and ROS-036
 *     measured $52,313 of open declined work sitting in that table.
 *
 * NOT IMPLEMENTED, DELIBERATELY: α · vehicleAgeMileageDue. The affinity query
 * loads no vehicle or mileage data, and inventing a signal from absent data is
 * how the last version got here. It stays in the design comment as future work,
 * not in MAX_AFFINITY_SCORE — the denominator only ever counts signals that
 * actually exist, or confidence silently deflates again.
 *
 * Pure by construction: no clock, no database, no I/O. Everything time-relative
 * arrives as a `daysSince` number so the whole model is testable.
 */

/** Recency contributes at most this many points. */
export const MAX_RECENCY_POINTS = 30;

/**
 * An open declined estimate contributes at most this many points — more than
 * recency, because it is a far stronger statement of intent. Recency says "it
 * has been a while"; a declined estimate says "we already told this person they
 * need this, in writing, and they have not come back for it".
 */
export const MAX_DECLINED_POINTS = 40;

/**
 * Denominator for normalizing score to confidence. Counts only the signals this
 * file actually implements, BEFORE the seasonal multiplier — so a strongly
 * in-season candidate can reach 1.0 with slightly less raw signal, which is the
 * intended behaviour, and an out-of-season one is damped rather than capped out.
 */
export const MAX_AFFINITY_SCORE = MAX_RECENCY_POINTS + MAX_DECLINED_POINTS;

/**
 * A customer needs at least this many observed service events before the model
 * will express any confidence about them. This replaces the old `sampleSize`
 * MULTIPLIER: sparse history should disqualify a customer, not quietly deflate
 * everyone's score toward zero.
 */
export const MIN_OBSERVATIONS_TO_SCORE = 2;

/** Had the service within this many days → suppress entirely. */
export const TOO_RECENT_DAYS = 30;

/** Recency is fully earned at this age. */
const RECENCY_SATURATION_DAYS = 365;

/** A declined estimate keeps this share of its weight once fully stale. */
const DECLINED_FLOOR = 0.25;
const DECLINED_STALE_DAYS = 365;

export interface AffinityInput {
  /**
   * Days since this customer last had this service category.
   * `Number.POSITIVE_INFINITY` when they have never had it.
   */
  daysSinceCategory: number;
  /** Seasonal demand multiplier for this category this month (roughly 0.7–1.5). */
  seasonal: number;
  /** True when an unconverted `alg_estimates` row exists in this category. */
  hasOpenDeclinedEstimate: boolean;
  /**
   * Days since that declined estimate was written.
   * `Number.POSITIVE_INFINITY` when there is none.
   */
  daysSinceDeclined: number;
  /** Total observed service events for this customer (the evidence precondition). */
  observations: number;
}

export interface AffinityResult {
  score: number;
  /** 0..1, normalized signal strength. Directly comparable to the outreach gate. */
  confidence: number;
  reasonParts: string[];
  /** True when the customer had this service too recently to pitch it. */
  suppressed: boolean;
  /** True when the customer has too little history to score at all. */
  insufficientEvidence: boolean;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Points from "it has been a while since they had this". */
export function recencyPoints(daysSinceCategory: number): number {
  if (!Number.isFinite(daysSinceCategory)) return 0; // never had it — neutral, not negative
  const span = RECENCY_SATURATION_DAYS - TOO_RECENT_DAYS;
  const earned = ((daysSinceCategory - TOO_RECENT_DAYS) / span) * MAX_RECENCY_POINTS;
  return Math.min(MAX_RECENCY_POINTS, Math.max(0, earned));
}

/**
 * Points from an open declined estimate, decaying with age but never to zero —
 * a two-year-old declined brake job is weaker evidence than a two-month-old one,
 * but it is still evidence, and the work does not un-need itself.
 */
export function declinedPoints(hasOpen: boolean, daysSinceDeclined: number): number {
  if (!hasOpen) return 0;
  if (!Number.isFinite(daysSinceDeclined)) return 0;
  const age = clamp01(Math.max(0, daysSinceDeclined) / DECLINED_STALE_DAYS);
  const freshness = 1 - (1 - DECLINED_FLOOR) * age;
  return MAX_DECLINED_POINTS * freshness;
}

/**
 * Score one (customer, service) pair.
 *
 * Returns `confidence` on the same 0..1 scale the outreach gate compares
 * against. Under the previous form this value could not exceed ~0.33 in
 * production; see the header for why.
 */
export function scoreServiceAffinity(input: AffinityInput): AffinityResult {
  const reasonParts: string[] = [];

  if (input.observations < MIN_OBSERVATIONS_TO_SCORE) {
    return {
      score: 0,
      confidence: 0,
      reasonParts: [],
      suppressed: false,
      insufficientEvidence: true,
    };
  }

  // Suppression first — if they just had it, nothing else matters and no reason
  // should be surfaced (a stale reason on a suppressed row is how bad copy ships).
  if (Number.isFinite(input.daysSinceCategory) && input.daysSinceCategory < TOO_RECENT_DAYS) {
    return {
      score: 0,
      confidence: 0,
      reasonParts: [],
      suppressed: true,
      insufficientEvidence: false,
    };
  }

  const recency = recencyPoints(input.daysSinceCategory);
  const declined = declinedPoints(input.hasOpenDeclinedEstimate, input.daysSinceDeclined);

  if (recency >= 20) {
    reasonParts.push(`last visit ${Math.floor(input.daysSinceCategory / 30)}mo ago`);
  }
  if (declined > 0) {
    reasonParts.push("open estimate they never came back for");
  }
  if (input.seasonal > 1.1) {
    reasonParts.push("in season");
  }

  const score = (recency + declined) * input.seasonal;

  return {
    score,
    confidence: Math.round(clamp01(score / MAX_AFFINITY_SCORE) * 100) / 100,
    reasonParts,
    suppressed: false,
    insufficientEvidence: false,
  };
}

/**
 * The confidence the OLD model would have produced, kept so the recalibration is
 * demonstrable rather than asserted. Referenced only by tests.
 *
 *   confidence = min(1, observations/8) × min(1, (recency × seasonal)/45)
 */
export function legacyConfidence(input: AffinityInput): number {
  const sampleSize = Math.min(1, input.observations / 8);
  const raw = recencyPoints(input.daysSinceCategory) * input.seasonal;
  const signalStrength = Math.min(1, raw / 45);
  return Math.round(sampleSize * signalStrength * 100) / 100;
}
