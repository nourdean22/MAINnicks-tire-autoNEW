/**
 * Honest rendering of brain_memories.confidence · 2026-08-19.
 *
 * `confidence` is NOT a probability. It is a re-sighting counter:
 * a memory is born at 0.5 and every reinforcement adds 0.1, capped at
 * 1.0 (lib/brain/memory-manager.ts:540). So "confidence 0.8" means
 * "seen about 4 times", never "80% likely to be true".
 *
 * The 2026-08-16 wave fixed this at the RECALL boundary (contextual-recall
 * renders provenance instead of `(NN%)`), but several operator surfaces
 * kept printing `Math.round(confidence * 100) + "%"` — and two of them
 * printed it directly beside the sighting count, i.e. the same number
 * twice with one copy lying about what it is.
 *
 * One helper, so this cannot drift back.
 */

/** Birth confidence for a new memory. */
export const CONFIDENCE_FLOOR = 0.5;
/** Added per reinforcement. */
export const CONFIDENCE_STEP = 0.1;
/** Hard ceiling — sightings beyond this are indistinguishable. */
export const CONFIDENCE_CEILING = 1.0;
/** Sightings implied by the ceiling: 0.5 + 0.1*(n-1) = 1.0 → n = 6. */
export const CEILING_SIGHTINGS = Math.round(
  (CONFIDENCE_CEILING - CONFIDENCE_FLOOR) / CONFIDENCE_STEP + 1,
);

/**
 * Invert the counter. Exact by construction, because the forward formula
 * is exact — this is arithmetic, not estimation.
 */
export function sightingsFromConfidence(confidence: number): number {
  const n = (confidence - CONFIDENCE_FLOOR) / CONFIDENCE_STEP + 1;
  return Math.max(1, Math.round(n));
}

/**
 * Operator-facing label for a confidence value when the true sighting
 * count is NOT available. Says what the number is; flags the ceiling
 * rather than pretending 1.0 means certainty.
 */
export function describeConfidenceAsAttention(confidence: number): string {
  if (confidence >= CONFIDENCE_CEILING) return `seen ${CEILING_SIGHTINGS}×+`;
  return `seen ~${sightingsFromConfidence(confidence)}×`;
}

/**
 * Preferred label when the real `seenCount` column IS available — always
 * better than inverting, because seenCount keeps counting past the cap.
 */
export function describeSeenCount(seenCount: number): string {
  if (seenCount <= 0) return "never seen";
  if (seenCount === 1) return "seen once";
  return `seen ${seenCount.toLocaleString()}×`;
}

/**
 * Tone for an attention level. Deliberately NOT a red→green "confidence"
 * ramp: a rarely-seen memory is not "bad", it is quiet — and a heavily
 * re-sighted one is not "true", it is familiar.
 */
export function attentionTone(sightings: number): "hot" | "warm" | "quiet" {
  if (sightings >= 5) return "hot";
  if (sightings >= 2) return "warm";
  return "quiet";
}
