/**
 * Slice a named region out of source text, failing LOUD when an anchor is gone.
 *
 * WHY THIS EXISTS. Dozens of tests in this app assert against a region of a
 * source file located by `indexOf` anchors:
 *
 *     const body = src.slice(start, src.indexOf("export function next"));
 *
 * When that anchor is absent, `indexOf` returns -1 — and `String.slice` treats a
 * negative `end` as an offset from the END of the string. So the failed search
 * does not throw and does not return empty: it silently widens the region to run
 * to one character before EOF. A `toContain` over that region then passes on
 * text from somewhere else entirely, and the test reports green while asserting
 * nothing about its subject.
 *
 * Measured 2026-09-10 across a 43-file run: `marginCoverageGuard.test.ts` bounded
 * a slice with `indexOf("\n// ")` against a source it had just run through
 * `stripComments()` — an anchor that could never match — so its "bound the slice
 * to THIS function" comment described a bound that did not exist, and three
 * unrelated engines were swept into the assertion.
 *
 * The rule this encodes: a missing anchor is a BROKEN TEST, not a wider match.
 * Every failure here is thrown with the marker in the message, so the fix is
 * obvious from the failure alone.
 */

export interface SliceBlockOptions {
  /**
   * Allow the block to run to the end of `source` when no end marker matches.
   * OFF by default — opt in only where reaching EOF is the genuine intent
   * (e.g. the subject really is the last declaration in the file).
   */
  toEndOfSource?: boolean;
  /** Label used in error messages, e.g. the file being parsed. */
  label?: string;
}

/**
 * @param startMarker  literal text that begins the region; must be present
 * @param endMarkers   one or more literal texts that could end it. The EARLIEST
 *                     match after the start wins, so passing several candidates
 *                     ("\nexport ", "\n}") is safe rather than ambiguous.
 */
export function sliceBlock(
  source: string,
  startMarker: string,
  endMarkers: string | string[],
  options: SliceBlockOptions = {},
): string {
  const where = options.label ? ` in ${options.label}` : "";

  const start = source.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`sliceBlock: start marker not found${where}: ${JSON.stringify(startMarker)}`);
  }

  const candidates = (Array.isArray(endMarkers) ? endMarkers : [endMarkers])
    // Search AFTER the start marker so a marker that also appears inside the
    // start text cannot produce a zero-length block.
    .map((m) => source.indexOf(m, start + startMarker.length))
    // Drop -1 (absent) explicitly. This filter is the whole point of the
    // helper: an unfiltered -1 is what silently becomes "slice to EOF".
    .filter((i) => i > start);

  if (candidates.length === 0) {
    if (options.toEndOfSource) return source.slice(start);
    throw new Error(
      `sliceBlock: no end marker found after ${JSON.stringify(startMarker)}${where}. ` +
        `Tried ${JSON.stringify(endMarkers)}. ` +
        `Pass { toEndOfSource: true } if running to the end of the file is intended.`,
    );
  }

  return source.slice(start, Math.min(...candidates));
}
