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
 *
 * ── MEASURED LIMIT (2026-08-19, prod, 900 most-recent live rows) ──
 * The inversion above is exact ONLY for rows written through
 * remember()/reinforce(). In practice 99% of recent rows have
 * seen_count = 1, and 73% of those carry a confidence a WRITER stamped
 * directly (output_critic 0.9 · brain-bus events 1.0 · gateway shadow
 * 0.1) — for them the inversion FABRICATES sightings ("seen 6×+" on a
 * row seen once). Therefore:
 *   · `describeSeenCount(seenCount)` is the default — it reads the real
 *     column and is always true.
 *   · `describeConfidenceAsAttention(confidence)` is a last resort for
 *     payloads that genuinely lack seen_count, and its output must be
 *     read as "at most this many formula-sightings", not history.
 * Consumers were migrated the same day (trace modal, health rollup);
 * continuity-view keeps the confidence fallback only for seenCount=0
 * payload rows.
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
 * LAST-RESORT label for a confidence value when the true sighting count
 * is genuinely unavailable. Prefer `describeSeenCount` everywhere the
 * row (or its query) can carry seen_count — see the header: for 73% of
 * recent writer-stamped rows this inversion overstates history.
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
