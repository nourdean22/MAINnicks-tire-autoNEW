/**
 * ATTRIBUTION CONFIDENCE, SAID IN WORDS — and the warning that goes with it.
 *
 * The review queue shows `0.9` and `0.75` next to real invoices, and an
 * operator confirming money reasonably reads those as "90% sure" and "75%
 * sure". They are not. Read the producer (`services/revenueAttribution.ts`):
 *
 *   1     — the call is linked to a lead, and that lead is uniquely linked to
 *           a paid invoice. An OBSERVED link, not an estimate.
 *   0.9   — exact normalized phone, paid inside the window, AND the service
 *           text overlaps.
 *   0.75  — exact normalized phone, paid inside the window, and NOTHING about
 *           the service matched or was available.
 *   null  — several plausible invoices, or no phone to match on.
 *
 * So 0.9 and 0.75 differ by EXACTLY ONE FACT: whether the service text
 * overlapped. They are ordinal labels for two evidence recipes, chosen by hand
 * and never calibrated against outcomes. NOBODY HAS EVER MEASURED how often a
 * 0.75 match turns out to be the right invoice, so the gap between them is not
 * fifteen percentage points of anything.
 *
 * That matters because the last defect found in this exact queue was an
 * over-count: eight calls claiming one invoice, each looking individually
 * plausible. A number that reads as a probability invites exactly the
 * batch-confirm behaviour that produced it.
 *
 * WHAT THIS MODULE ADDS, AND DELIBERATELY DOES NOT. It names each band, says
 * what evidence produced it, and says what would RAISE it — the only actionable
 * part. It does NOT invent a calibrated probability, does not rank within a
 * band, and does not recommend confirming anything. Calibration would need a
 * labelled sample of confirmed and rejected decisions, which does not exist
 * yet; the band for that is stated as uncalibrated rather than guessed.
 *
 * Pure and total.
 */

export type ConfidenceBand = "verified" | "strong" | "weak" | "unscored";

export interface BandDescription {
  band: ConfidenceBand;
  /** Short label for the row chip. */
  label: string;
  /** What evidence actually produced this band. */
  basis: string;
  /**
   * What would move this row up a band, or null when nothing can — the only
   * part an operator can act on without opening the call.
   */
  whatWouldRaiseIt: string | null;
  /**
   * True when the band rests on an OBSERVED link rather than an inference.
   * Only `verified` is observed; everything else is a guess with a number.
   */
  observed: boolean;
}

const DESCRIPTIONS: Record<ConfidenceBand, Omit<BandDescription, "band">> = {
  verified: {
    label: "Verified link",
    basis: "The call is linked to a lead, and that lead is uniquely linked to this paid invoice. This is a recorded relationship, not an inference.",
    whatWouldRaiseIt: null,
    observed: true,
  },
  strong: {
    label: "Phone + time + service",
    basis: "Exact phone match, invoice paid inside the window, and the service the caller mentioned overlaps the invoice description.",
    whatWouldRaiseIt:
      "Only a recorded lead link would make this observed rather than inferred — capturing the lead during the call is what creates one.",
    observed: false,
  },
  weak: {
    label: "Phone + time only",
    basis: "Exact phone match and invoice paid inside the window. Nothing about the service matched, or no service was captured on the call.",
    whatWouldRaiseIt:
      "Capturing what the caller actually asked for would let the service text be compared at all. Most of these are missing the caller's request, not failing to match it.",
    observed: false,
  },
  unscored: {
    label: "No single invoice",
    basis: "Several paid invoices are equally plausible, or the call carried no matchable phone number. No specific money is being claimed.",
    whatWouldRaiseIt:
      "A phone number on the call, or a lead captured during it. Without one of those there is nothing to match on.",
    observed: false,
  },
};

/**
 * The honesty line that must travel with any band display.
 *
 * Stated once, exported, so the UI cannot show bands without it and a future
 * reader cannot mistake the ordering for calibration.
 */
export const BAND_CALIBRATION_CAVEAT =
  "These bands rank evidence, not probability. Nobody has yet measured how often a phone-and-time match turns out to be the right invoice, so the gap between bands is an ordering, not a percentage.";

export function bandOf(confidence: number | null | undefined): ConfidenceBand {
  if (confidence == null || Number.isNaN(confidence)) return "unscored";
  if (confidence >= 1) return "verified";
  if (confidence >= 0.9) return "strong";
  if (confidence > 0) return "weak";
  // Zero is a real score meaning no evidence — not the same as unscored, but
  // there is no band below weak, and inventing one would imply a distinction
  // the producer never makes.
  return "unscored";
}

export function describeBand(band: ConfidenceBand): BandDescription {
  return { band, ...DESCRIPTIONS[band] };
}

export interface BandMix {
  verified: number;
  strong: number;
  weak: number;
  unscored: number;
  /** Total rows counted. */
  total: number;
  /**
   * Share of rows resting on an INFERENCE rather than an observed link, 0-100,
   * null when there are no rows. This is the number worth watching: a queue
   * that is mostly inference is a queue where confirming in bulk is guessing
   * in bulk.
   */
  inferredPct: number | null;
}

export function bandMix(confidences: ReadonlyArray<number | null | undefined>): BandMix {
  const mix: BandMix = { verified: 0, strong: 0, weak: 0, unscored: 0, total: 0, inferredPct: null };
  for (const c of confidences) {
    mix[bandOf(c)] += 1;
    mix.total += 1;
  }
  if (mix.total > 0) {
    mix.inferredPct = Math.round(((mix.total - mix.verified) / mix.total) * 100);
  }
  return mix;
}
