/**
 * Beat-structure signals — deterministic properties of a reel's SHAPE (not
 * just its opening), for the same kind of correlation `hookSignals.ts` runs
 * on beat 1. Stage 1 discipline carries over unchanged: nothing here scores,
 * gates, or judges. `analyze-hook-vs-skip.mjs` only ever joined beat 1
 * against skip rate — the brief this file answers ("Attention Microstructure
 * swipe-file") also wants beat COUNT, total length, and the CTA, which are
 * read from the same `reel_jobs.payload` beat 1 already comes from.
 */
import type { CtaType } from "./instagramStudio";

export interface BeatStructureInput {
  storyboardBeats?: Array<{ beatNumber: number; startSecond?: number; endSecond?: number }>;
  ctaType?: CtaType | null;
}

export interface BeatStructureSignals {
  beatCount: number;
  /** Derived from the LAST beat's endSecond — the brief's declared 15-22s
   *  band is a target, not an enforced gate here (that decision belongs to
   *  the QC gate, not to a measurement tool). Null when no beat carries an
   *  endSecond, so "unknown" is never read as zero. */
  totalDurationSeconds: number | null;
  /** CtaType's own "none" member IS the no-CTA case (CTA_TYPES,
   *  shared/instagramStudio.ts) — no separate sentinel needed. */
  ctaType: CtaType;
  /** Whether a CTA was set at all — "none" is a deliberate choice in this
   *  codebase (see reelBriefGen.ts's "the CTA is optional" note), not a gap. */
  hasCta: boolean;
}

export function extractBeatStructureSignals(input: BeatStructureInput): BeatStructureSignals {
  const beats = input.storyboardBeats ?? [];
  const ends = beats.map((b) => b.endSecond).filter((n): n is number => typeof n === "number");
  const ctaType = input.ctaType ?? "none";
  return {
    beatCount: beats.length,
    totalDurationSeconds: ends.length ? Math.max(...ends) : null,
    ctaType,
    hasCta: ctaType !== "none",
  };
}

/** The signal names a correlation can group by — mirrors HOOK_BOOLEAN_SIGNALS'
 *  shape so both families can feed the same generalized comparator. */
export const BEAT_STRUCTURE_BOOLEAN_SIGNALS = ["hasCta"] as const;
export type BeatStructureBooleanSignal = typeof BEAT_STRUCTURE_BOOLEAN_SIGNALS[number];
