/**
 * Hook signals — deterministic properties of a reel's OPENING, for correlating
 * against how many people actually stayed.
 *
 * STAGE 1 OF THREE, AND IT DELIBERATELY DOES NOT JUDGE.
 *
 * Nothing here scores, gates, or blocks. Each function answers one factual
 * question about beat 1 so those answers can be joined to `skip_rate` and the
 * data can say which properties matter. Whether a "warm-up opener" is bad is a
 * question for the measurement, not for this file.
 *
 * WHY THAT RESTRAINT: the existing hook check
 * (`facelessReelStudio.ts` "First-frame scroll-stop") awards 10/10 whenever
 * beat 1 starts at 0s with any non-empty visual and any non-empty text. It gave
 * reel #1230001 a perfect score; that reel measured an 82.6 skip rate and 3.0s
 * average watch. A presence check wearing a quality score's clothes is worse
 * than no check — it reports the hook as solved.
 *
 * Writing a *replacement* score today would repeat the mistake in a new costume:
 * there are 8 posts with a skip rate, which is enough to look for a signal and
 * nowhere near enough to enforce one. So: measure first, judge later, gate last.
 *
 * These read the DESIGN (beat-1 visual + on-screen text), not pixels. Design
 * text exists for every reel ever generated, so the correlation can run over the
 * whole history for free. Pixel-level judgment is stage 2, and only for the
 * properties stage 1 shows are worth the render cost.
 */

export interface HookInput {
  /** Beat 1 `visual` — what the generator was asked to render. */
  visual: string;
  /** Beat 1 `onScreenText` — the ffmpeg overlay, i.e. the words a viewer reads. */
  onScreenText: string;
  /** Beat 1 `motion`, when present. */
  motion?: string;
}

export interface HookSignals {
  /** Opens tight on a physical subject (macro/close/detail) rather than a scene. */
  opensTight: boolean;
  /** Opens on an establishing/context shot — a scene before a subject. */
  opensWide: boolean;
  /** First words are a warm-up: scene-setting, "ever wonder", a trailing ellipsis. */
  textIsWarmup: boolean;
  /** First words pose a question. */
  textIsQuestion: boolean;
  /** First words assert something concrete and checkable (a number, a comparison). */
  textIsClaim: boolean;
  /** Movement is specified in the opening beat rather than a static hold. */
  hasMotion: boolean;
  /** Word count of the overlay — long openers cost reading time before any payoff. */
  textWords: number;
}

const TIGHT = /\b(macro|extreme close|close-?up|detail shot|cutaway|cross-?section|x-?ray)\b/i;
const WIDE = /\b(wide|establishing|aerial|drone|landscape|skyline|panoram\w*|street scene)\b/i;

/**
 * Warm-up openers. Every pattern here is a line that spends the first seconds
 * on context instead of the thing itself — including the literal opener that
 * scored 10/10 and then lost 82.6% of viewers:
 *   "Cleveland winters bring more than just snow..."
 */
const WARMUP = [
  /\b(?:ever wonder|did you know|let'?s talk|here'?s the thing|picture this)\b/i,
  /\bbrings? more than\b/i,
  /^\s*(?:in|out|around|here in|living in)\s+\w+[^.?!]{0,30},/i,   // "In Cleveland, ..."
  /\b(?:winters?|summers?|seasons?)\s+(?:bring|mean|are)\b/i,
  /\.\.\.\s*$/,                                                    // trailing ellipsis = throat-clearing
];

// `\w*`, NOT `\w+`, on every stem that is already a valid word. `orbit\w+`
// requires at least one character AFTER the stem, so the bare word "orbit"
// never matched — "slow orbit around the rim" read as static. `rotat` keeps
// `\w+` because it is not a word on its own and needs a suffix.
//
// Third instance of this family today: a `\b` after a `%` that can never match,
// a `\b` after a truncated stem, and now `\w+` where `\w*` was meant. The base
// form and the inflected form both need testing, by reflex.
const MOTION = /\b(rotat\w+|spin\w*|turn\w*|travel\w*|push\w*|pull\w*|sweep\w*|orbit\w*|track\w*|slow motion|reveal\w*|drip\w*|spread\w*|creep\w*)\b/i;

/** A concrete assertion: a measurement, a comparison, or a named consequence. */
const CLAIM = [
  /\d+\s*(?:\/\s*\d+|%|psi|mph|miles|degrees|seconds?|inch(?:es)?)/i,
  /\b(?:is not|isn'?t|never|always|means?|costs?|requires?)\b/i,
  /\bvs\.?\b|\bversus\b/i,
];

const any = (pats: RegExp[], s: string) => pats.some((p) => p.test(s));

export function extractHookSignals(input: HookInput): HookSignals {
  const visual = `${input.visual ?? ""} ${input.motion ?? ""}`.trim();
  const text = String(input.onScreenText ?? "").trim();
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;

  return {
    opensTight: TIGHT.test(visual),
    opensWide: WIDE.test(visual),
    textIsWarmup: any(WARMUP, text),
    textIsQuestion: /\?/.test(text),
    textIsClaim: any(CLAIM, text),
    hasMotion: MOTION.test(visual),
    textWords: words,
  };
}

/** The signal names a correlation can group by. Excludes textWords (continuous). */
export const HOOK_BOOLEAN_SIGNALS = [
  "opensTight", "opensWide", "textIsWarmup", "textIsQuestion", "textIsClaim", "hasMotion",
] as const;
export type HookBooleanSignal = typeof HOOK_BOOLEAN_SIGNALS[number];

/**
 * Minimum posts per group before a difference is worth reporting as anything
 * but noise. Deliberately conservative: the whole point of stage 1 is to avoid
 * inventing a rule from a handful of posts, which is how the save-CTA
 * overcorrection happened (shipped off a zero baseline, reversed within an hour).
 */
export const MIN_GROUP_N = 4;

export interface SignalComparison {
  signal: HookBooleanSignal;
  withN: number;
  withoutN: number;
  withAvgSkip: number | null;
  withoutAvgSkip: number | null;
  /** Negative = posts WITH this signal were skipped less (better). */
  delta: number | null;
  /** False when either group is under MIN_GROUP_N — the delta is not reportable. */
  sufficient: boolean;
}

/**
 * Compare average skip rate for posts with vs without each signal.
 *
 * `skipRate` NULL means NOT REPORTED and the post is excluded — never counted as
 * zero. A post Instagram declined to measure is not a post nobody skipped.
 */
export function compareSignals(
  samples: Array<{ signals: HookSignals; skipRate: number | null }>,
): SignalComparison[] {
  const usable = samples.filter((s) => s.skipRate !== null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  return HOOK_BOOLEAN_SIGNALS.map((signal) => {
    const withIt = usable.filter((s) => s.signals[signal]).map((s) => s.skipRate as number);
    const without = usable.filter((s) => !s.signals[signal]).map((s) => s.skipRate as number);
    const a = mean(withIt);
    const b = mean(without);
    return {
      signal,
      withN: withIt.length,
      withoutN: without.length,
      withAvgSkip: a,
      withoutAvgSkip: b,
      delta: a !== null && b !== null ? a - b : null,
      sufficient: withIt.length >= MIN_GROUP_N && without.length >= MIN_GROUP_N,
    };
  });
}
