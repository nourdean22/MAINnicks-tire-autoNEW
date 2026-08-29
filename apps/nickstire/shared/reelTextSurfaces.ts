/**
 * Every word burned into a reel must be DECLARED. Undeclared text in the frame
 * is made impossible here, not merely noticed later.
 *
 * ── THE DEFECT, AND WHY IT IS BIGGER THAN ONE CARD ──────────────────────────
 * Reel 1770003's payload declares FIVE storyboard beats. The rendered file
 * contains SIX text cards: the five beat captions, plus a sixth reading
 * `SAVE THIS | DM "SALT"` that appears nowhere in the payload. It was built by
 * `reelAssembly.ts` from `brief.campaignKeyword` at render time.
 *
 * The consequence is not one stray card. It is that **every payload-only review
 * this pipeline has ever had was reading an incomplete artifact.** A reviewer
 * who read the storyboard and approved it had not seen everything the viewer
 * sees. That is precisely how the end card survived a hand audit that was
 * specifically looking for burned-in defects - and it is the same shape as reel
 * 1770005, where a false claim about Ohio law ("Automatic E-Check FAILED",
 * against Ohio EPA's seven-county program) lived in pixels no payload review
 * would ever surface.
 *
 * ── WHICH DIRECTION IS ENFORCED, AND WHY ────────────────────────────────────
 * Two options existed: render FROM the declaration, or assert the render
 * AGAINST it. This module does both, from ONE source, because each is cheap
 * only in one direction:
 *
 *   - Render from the declaration. `declaredTextSurfaces()` is the single list
 *     the assembler writes to disk AND the single list the filtergraph may
 *     reference. There is no second place a card can come from.
 *
 *   - Assert the render against it. `undeclaredTextProblem()` reads the built
 *     ffmpeg arg vector and fails if it draws any text the declaration does not
 *     contain - including inline `text='...'`, which bypasses the file list
 *     entirely.
 *
 * The assertion is on the FILTERGRAPH, not on the pixels. Asserting pixels
 * would need OCR: slow, flaky, unavailable in a unit test, and it can only run
 * after a five-minute render. The filtergraph is what deterministically
 * produces the pixels, it is a plain string array, and it fails at the moment
 * the defect is introduced rather than after it is published.
 */

/** One text file the render will write, and the exact text in it. */
export interface DeclaredTextSurface {
  /** Filename inside the ffmpeg working directory. */
  file: string;
  text: string;
}

/** The caption-bearing shape this module needs. Matches ReelSegment. */
export interface CaptionedSegment {
  caption: string;
}

/**
 * Every text surface the render is allowed to draw, in order.
 *
 * Beat captions are split per line because the assembler writes one file per
 * line (`caption_<beat>_<line>.txt`) and draws one `drawtext` per file - so the
 * declaration has to be at the same granularity as the thing it constrains, or
 * the counts would never line up.
 *
 * `askText` is the single end-card ask (see shared/reelAsk.ts). Null means no
 * end card, which is the correct outcome when nothing declared one.
 */
export function declaredTextSurfaces(
  segs: CaptionedSegment[],
  askText: string | null,
  /**
   * True when a voiceover alignment exists, because the assembler then burns
   * beat text through a SUBTITLES filter INSTEAD of per-line drawtext - the two
   * caption mechanisms are mutually exclusive (`if (assPath) ... else ...` in
   * buildFfmpegArgs). Declaring caption files in that mode would describe files
   * the render never draws, which is the opposite drift and just as wrong.
   */
  captionsViaSubtitles = false,
): DeclaredTextSurface[] {
  const out: DeclaredTextSurface[] = [];
  if (!captionsViaSubtitles) {
    segs.forEach((seg, i) => {
      seg.caption.split("\n").forEach((line, j) => {
        out.push({ file: `caption_${i}_${j}.txt`, text: line });
      });
    });
  }
  if (askText !== null && askText !== "") {
    out.push({ file: "caption_save.txt", text: askText });
  }
  return out;
}

export interface FiltergraphTextSources {
  /** `textfile='X'` referenced by a drawtext filter. */
  textfiles: string[];
  /** `text='...'` written inline - bypasses the declared file list entirely. */
  inline: string[];
  /** True when a burned-in subtitle track (VO word timing) is applied. */
  usesSubtitles: boolean;
}

/**
 * Every text source the built ffmpeg args will draw.
 *
 * Scans the whole arg vector rather than a filter-complex substring, because a
 * text source added anywhere in the vector still reaches the frame.
 */
export function filtergraphTextSources(args: string[]): FiltergraphTextSources {
  const joined = args.join(" ");
  const textfiles: string[] = [];
  const inline: string[] = [];

  // PARAMETER-AWARE, not a loose substring scan. The first version used
  // /drawtext=[^\s]*?[:=]text='...'/ and silently missed `drawtext=text='X'`
  // - the very shape an inline card takes - because it required a delimiter
  // before `text`. Anchoring on the parameter position instead: a drawtext
  // filter's params are colon-separated, so `text` is a param when it is at
  // the start of the filter body or directly after a colon. That also keeps
  // `textfile=` from being read as `text=`.
  for (const chunk of joined.split("drawtext=").slice(1)) {
    const body = chunk.split(/[;\[]/)[0];
    const fileMatch = /(?:^|:)textfile='([^']+)'/.exec(body);
    if (fileMatch) textfiles.push(fileMatch[1]);
    const inlineMatch = /(?:^|:)text='([^']*)'/.exec(body);
    if (inlineMatch) inline.push(inlineMatch[1]);
  }

  // The `]` matters: a filter is prefixed by its input label, so the real
  // string is `[vc]subtitles='...'`. Omitting it made this silently never fire
  // — caught by the canary, which is the entire point of writing one.
  const usesSubtitles = /(^|[\s;,\[\]])(subtitles|ass)=/.test(joined);
  return { textfiles, inline, usesSubtitles };
}

/**
 * Why this render draws text nobody declared, or null when it is clean.
 *
 * `voDeclared` covers the SECOND burn-in mechanism: when a voiceover exists the
 * assembler burns word-timed subtitles from the VO alignment. That text is
 * declared - it is the voiceover script - but only if the payload actually has
 * one. Subtitles with no declared VO would be text from nowhere, same defect
 * class through a different filter.
 */
export function undeclaredTextProblem(
  args: string[],
  declared: DeclaredTextSurface[],
  voDeclared = false,
): string | null {
  const found = filtergraphTextSources(args);

  if (found.inline.length) {
    return (
      `the filtergraph draws ${found.inline.length} INLINE text value(s) — ` +
      `${JSON.stringify(found.inline.slice(0, 3))}. Every burned-in card must come from the ` +
      "declared surface list, or a reviewer reading the payload has not seen what the viewer sees."
    );
  }

  // Checked BEFORE the file comparisons: when subtitles are burned in they
  // REPLACE the per-beat drawtext, so an undeclared VO track would otherwise
  // surface as a confusing "declared but never drawn" message about caption
  // files, pointing at the wrong defect.
  if (found.usesSubtitles && !voDeclared) {
    return (
      "the filtergraph burns in a subtitle track but the payload declares no voiceover — " +
      "spoken words would reach the frame with nothing declaring them."
    );
  }

  const allowed = new Set(declared.map((d) => d.file));
  const undeclared = found.textfiles.filter((f) => !allowed.has(f));
  if (undeclared.length) {
    return (
      `the filtergraph draws text from ${JSON.stringify([...new Set(undeclared)])}, which the ` +
      "storyboard does not declare. This is the 1770003 end-card defect: five beats planned, six cards rendered."
    );
  }

  // The reverse drift also matters: a declared card silently not drawn means
  // the payload over-describes the render, and a reviewer approves words the
  // viewer never sees.
  const drawn = new Set(found.textfiles);
  const missing = declared.filter((d) => !drawn.has(d.file)).map((d) => d.file);
  if (missing.length) {
    return (
      `the storyboard declares ${JSON.stringify(missing)} but the filtergraph never draws ` +
      "them — the payload describes a render that does not exist."
    );
  }

  return null;
}
