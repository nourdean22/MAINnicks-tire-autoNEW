/**
 * Strategic Frameworks — type contract · v10.0.235
 *
 * Each framework is a "lens" Nick can apply when reasoning about
 * business / money / strategy questions. The registry is intentionally
 * extensible · adding a new framework is a single new file in
 * `frameworks/` + a single import in `index.ts`. Nick's reasoning gets
 * smarter every time we add one.
 *
 * Design intent:
 *   · Frameworks are LENSES, not procedures. Each one tells Nick how
 *     to look at the question, not the answer.
 *   · The detector returns the BEST matches (max 3), not all matches.
 *     The injected prompt block stays compact.
 *   · Future frameworks (Lean Canvas, OKRs, RICE, ICE, blue-ocean,
 *     North-Star metric, AARRR, etc.) plug into the same registry
 *     without changing the detection / injection plumbing.
 */

export interface StrategicFramework {
  /** Stable id · used for telemetry + framework picking. snake-case. */
  id: string;
  /** Display name · what Nick references when applying this lens. */
  name: string;
  /** One-line summary of what the framework reveals. */
  oneLiner: string;
  /** Trigger patterns · regex tested against the user message.
   *  Order matters · earlier patterns are stronger signals. */
  triggers: RegExp[];
  /** Negative triggers · if any of these match, the framework does
   *  NOT activate even if a positive trigger hit. Used to suppress
   *  false-fires (e.g. "price of admission" = idiom, not pricing). */
  antiTriggers?: RegExp[];
  /** Reasoning prompt Nick uses when the lens activates. Short
   *  imperative · 3-6 sentences. Tells the model HOW to think, not
   *  what to say. Reads as a section under "## STRATEGIC LENS". */
  lens: string;
  /** Confidence boost when the framework's keywords appear · used
   *  for picking top-N when multiple frameworks match. Default 1.0. */
  weight?: number;
  /** 2026-05-23 · Wave E · marks a lens as "featured" for the
   *  generic fallback. When no specific framework triggers but the
   *  intent is business/strategy, only featured lenses get listed.
   *  Pre-fix all 49 frameworks dumped their headlines → ~700-1000
   *  tokens injected on every casual mention. Featured-only keeps
   *  the fallback compact (~150 tokens) while preserving the choice
   *  set for Nick. Default false. */
  featured?: boolean;
}

export interface FrameworkMatch {
  framework: StrategicFramework;
  /** How many positive triggers hit. Higher = stronger signal. */
  score: number;
  /** The matched substrings · for telemetry. */
  matched: string[];
}
