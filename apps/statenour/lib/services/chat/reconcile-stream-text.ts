/**
 * Reconcile the text collected from visible stream deltas with the SDK's
 * final `onFinish` text.
 *
 * The two values should normally be identical. When they are not, using the
 * delta accumulator is safe only when one value is an exact extension of the
 * other. That covers a dropped leading/trailing delta without inventing a
 * bridge for unrelated text. Ambiguous mismatches stay on the SDK value and
 * are reported by the caller.
 */

const MAX_SAFE_GAP = 2_000;

export type StreamTextRelation =
  | "exact"
  | "accumulator-replaces-empty"
  | "accumulator-has-prefix"
  | "accumulator-has-suffix"
  | "final-has-suffix"
  | "ambiguous";

export interface StreamTextReconciliation {
  text: string;
  relation: StreamTextRelation;
  recoveredChars: number;
}

export function reconcileStreamText(
  finalText: string,
  accumulatedText: string,
): StreamTextReconciliation {
  if (finalText === accumulatedText) {
    return { text: finalText, relation: "exact", recoveredChars: 0 };
  }

  if (!accumulatedText) {
    return { text: finalText, relation: "ambiguous", recoveredChars: 0 };
  }

  // The SDK can omit every visible delta from its final event. The caller
  // still sends this through the normal salvage/sanitization pipeline before
  // it is persisted, so leaked provider reasoning is not accepted as answer
  // text merely because it was present in the raw accumulator.
  if (!finalText) {
    return {
      text: accumulatedText,
      relation: "accumulator-replaces-empty",
      recoveredChars: accumulatedText.length,
    };
  }

  const gap = Math.abs(accumulatedText.length - finalText.length);
  if (gap > MAX_SAFE_GAP) {
    return { text: finalText, relation: "ambiguous", recoveredChars: 0 };
  }

  // The final event dropped the leading visible delta — the measured defect.
  if (finalText.length > 0 && accumulatedText.endsWith(finalText)) {
    return {
      text: accumulatedText,
      relation: "accumulator-has-prefix",
      recoveredChars: gap,
    };
  }

  // The final event dropped the trailing visible delta.
  if (finalText.length > 0 && accumulatedText.startsWith(finalText)) {
    return {
      text: accumulatedText,
      relation: "accumulator-has-suffix",
      recoveredChars: gap,
    };
  }

  // The accumulator can be briefly behind the final event if a provider
  // closes before the last callback reaches the shared ref. Keep the final
  // event in that case; it is the more complete representation.
  if (finalText.startsWith(accumulatedText)) {
    return {
      text: finalText,
      relation: "final-has-suffix",
      recoveredChars: 0,
    };
  }

  return { text: finalText, relation: "ambiguous", recoveredChars: 0 };
}
