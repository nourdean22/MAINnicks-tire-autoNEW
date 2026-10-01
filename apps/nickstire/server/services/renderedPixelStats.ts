/**
 * Deterministic pixel checks over the frames rendered QA already extracts
 * (Creative Intelligence OS README §L.1 — "$0 checks before the vision call").
 *
 * The vision critic costs one Gemini call per reel and judges taste. These
 * checks cost nothing, judge arithmetic, and run on the SAME jpegs
 * `extractReelFrames` already wrote (first, one midpoint per beat, final), so
 * there is no second ffmpeg pass. Their output is fed into the critic prompt as
 * PRE-FLAGS (PROMPT-PACK §13 `{{PIXEL_STATS}}`) and folded into `craftScore`.
 *
 * Four signals, all on a downscaled grayscale copy of each frame:
 *
 *   sharpness       variance of a 3x3 Laplacian — the classic blur detector.
 *                   Low = soft/over-smoothed, the pixel-level cousin of
 *                   PLASTIC_AI_LOOK (a proxy, not a verdict).
 *   dupOfPrev       mean absolute difference between this BEAT frame's
 *                   thumbnail and the previous beat's. Near-zero across two
 *                   different beats means a frozen or duplicated clip.
 *   black           near-black frame (mean luma AND spread both tiny) — a
 *                   failed clip, a fade that never came up, a bad trim.
 *   captionBoxBusy  detail density in the HALO around the caption band. The
 *                   caption itself is already burned in when these frames are
 *                   taken, so the band's own variance is the text; what we can
 *                   measure is whether the subject is dense right where the
 *                   caption sits (CAPTION_OBSTRUCTION proxy). The band comes
 *                   from reelAssembly's own geometry, not a copied number.
 *
 * THRESHOLDS ARE HYPOTHESES. They were set against synthetic fixtures (the
 * unit test) and have not been calibrated on a production reel — no reel can
 * be rendered from this checkout (see the nickstire-verifier-reel-pipeline
 * skill). They are named constants, returned on every result, and the prompt
 * tells the critic they are evidence to confirm or refute, never findings.
 *
 * NEVER THROWS INTO THE PIPELINE. Any sharp/IO failure returns
 * `{ skipped: true, reason }` so the vision critic still runs — missing
 * pre-flags are a weaker prompt, not a held reel.
 */
import sharp from "sharp";
import type { ExtractedFrame } from "./renderedQa";
import { CAPTION_SAFE, CAPTION_BEAT_Y_FRAC } from "./reelAssembly";

/** Width every frame is downscaled to before analysis (9:16 → 270×480). Fast,
 *  and the Laplacian at this scale ignores codec grain while still separating
 *  a focused macro from a smeared one. */
const ANALYSIS_WIDTH = 270;

/** Block size for the duplicate-detection thumbnail (270/10 × 480/10). */
const DUP_BLOCK = 10;

const THRESHOLDS = {
  /** Laplacian variance below this is flagged SOFT. Synthetic fixtures: a
   *  sharp noise frame scores in the thousands, a sigma-6 blur of the same
   *  frame under 10. Real photographic frames are expected to land well above
   *  this; HYPOTHESIS until measured on a production reel. */
  softSharpnessMax: 25,
  /** Mean |Δluma| (0–255) between consecutive BEAT thumbnails at or below
   *  which the later beat is a duplicate of the earlier one. */
  dupMeanAbsDiffMax: 3,
  /** Mean luma at or below this AND spread at or below blackStdMax = black. */
  blackMeanMax: 14,
  blackStdMax: 8,
  /** Luma std-dev in the caption halo at or above which the subject is dense
   *  where the caption sits. */
  captionHaloStdMin: 42,
  /** Caption band height as a fraction of frame height: two lines at the
   *  56px band font × 1.2 line height + drawtext box padding ≈ 190px on a
   *  1920px frame. */
  captionBandFrac: 0.10,
  /** Halo thickness (above and below the band) as a fraction of frame height. */
  captionHaloFrac: 0.06,
} as const;

export interface PixelFrameStats {
  label: string;
  beat: number | null;
  /** Laplacian variance on the analysis-scale grayscale (higher = sharper). */
  sharpness: number;
  /** Mean luma 0–255 (diagnostic, drives `black`). */
  meanLuma: number;
  dupOfPrev: boolean;
  black: boolean;
  captionBoxBusy: boolean;
}

export type PixelStats =
  | { skipped: true; reason: string }
  | {
      skipped: false;
      perFrame: PixelFrameStats[];
      /** `CODE:label` strings — SOFT_FRAME, DUP_FRAME, BLACK_FRAME, CAPTION_BOX_BUSY. */
      flags: string[];
      thresholds: typeof THRESHOLDS;
      analysisWidth: number;
    };

interface Gray {
  data: Buffer;
  w: number;
  h: number;
}

async function loadGray(file: string): Promise<Gray> {
  const { data, info } = await sharp(file)
    .resize({ width: ANALYSIS_WIDTH, withoutEnlargement: false })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1) throw new Error(`expected 1 channel after greyscale, got ${info.channels}`);
  return { data, w: info.width, h: info.height };
}

function laplacianVariance(g: Gray): number {
  const { data, w, h } = g;
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function meanStd(data: Buffer, idx: Iterable<number>): { mean: number; std: number; n: number } {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (const i of idx) {
    const v = data[i];
    sum += v;
    sumSq += v * v;
    n++;
  }
  if (!n) return { mean: 0, std: 0, n: 0 };
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), n };
}

function* allIdx(g: Gray): Iterable<number> {
  for (let i = 0; i < g.w * g.h; i++) yield i;
}

/** Pixels in the two halo strips around the caption band, restricted to the
 *  caption's horizontal safe width (CAPTION_SAFE.maxWidthFrac, centred). */
function* haloIdx(g: Gray, bandTopFrac: number): Iterable<number> {
  const x0 = Math.round((g.w * (1 - CAPTION_SAFE.maxWidthFrac)) / 2);
  const x1 = g.w - x0;
  const bandTop = Math.round(g.h * bandTopFrac);
  const bandBottom = Math.round(g.h * (bandTopFrac + THRESHOLDS.captionBandFrac));
  const haloPx = Math.round(g.h * THRESHOLDS.captionHaloFrac);
  const strips: Array<[number, number]> = [
    [Math.max(0, bandTop - haloPx), bandTop],
    [bandBottom, Math.min(g.h, bandBottom + haloPx)],
  ];
  for (const [y0, y1] of strips) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) yield y * g.w + x;
  }
}

/** Where the caption band starts for this frame. The hook caption (first
 *  frame / beat 1) is vertically centred by reelAssembly; every later beat's
 *  caption anchors at CAPTION_BEAT_Y_FRAC. */
function captionBandTopFrac(frame: ExtractedFrame): number {
  const isHook = frame.label === "first" || frame.beatNumber === 1;
  return isHook ? 0.5 - THRESHOLDS.captionBandFrac / 2 : CAPTION_BEAT_Y_FRAC;
}

function thumbnail(g: Gray): Float64Array {
  const tw = Math.max(1, Math.floor(g.w / DUP_BLOCK));
  const th = Math.max(1, Math.floor(g.h / DUP_BLOCK));
  const out = new Float64Array(tw * th);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      let s = 0;
      for (let y = 0; y < DUP_BLOCK; y++) {
        for (let x = 0; x < DUP_BLOCK; x++) s += g.data[(ty * DUP_BLOCK + y) * g.w + tx * DUP_BLOCK + x];
      }
      out[ty * tw + tx] = s / (DUP_BLOCK * DUP_BLOCK);
    }
  }
  return out;
}

function meanAbsDiff(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 255;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
}

/**
 * Compute the per-frame stats + flags for already-extracted frames. Resolves
 * to `{ skipped: true }` on ANY failure — the caller is a best-effort QA hook
 * and must never lose the vision verdict to a pixel-stat bug.
 */
export async function computeRenderedPixelStats(frames: ExtractedFrame[]): Promise<PixelStats> {
  try {
    if (!frames.length) return { skipped: true, reason: "no frames" };
    const perFrame: PixelFrameStats[] = [];
    const flags: string[] = [];
    let prevBeatThumb: Float64Array | null = null;
    for (const frame of frames) {
      const g = await loadGray(frame.path);
      const whole = meanStd(g.data, allIdx(g));
      const sharpness = laplacianVariance(g);
      const halo = meanStd(g.data, haloIdx(g, captionBandTopFrac(frame)));
      const black = whole.mean <= THRESHOLDS.blackMeanMax && whole.std <= THRESHOLDS.blackStdMax;
      // Duplicate detection compares BEAT frames to each other. `first` and
      // `final` share a clip with beat 1 / the last beat by construction, so a
      // near-match there is the expected shape of a still shot, not a freeze.
      const isBeat = frame.label.startsWith("beat");
      let dupOfPrev = false;
      if (isBeat) {
        const thumb = thumbnail(g);
        if (prevBeatThumb) dupOfPrev = meanAbsDiff(prevBeatThumb, thumb) <= THRESHOLDS.dupMeanAbsDiffMax;
        prevBeatThumb = thumb;
      }
      // A black frame has no caption halo worth reading, and a soft score on
      // it is meaningless — report the dominant defect only.
      const captionBoxBusy = !black && halo.n > 0 && halo.std >= THRESHOLDS.captionHaloStdMin;
      const soft = !black && sharpness < THRESHOLDS.softSharpnessMax;
      perFrame.push({
        label: frame.label,
        beat: frame.beatNumber,
        sharpness: Number(sharpness.toFixed(1)),
        meanLuma: Number(whole.mean.toFixed(1)),
        dupOfPrev,
        black,
        captionBoxBusy,
      });
      if (black) flags.push(`BLACK_FRAME:${frame.label}`);
      if (soft) flags.push(`SOFT_FRAME:${frame.label}`);
      if (dupOfPrev) flags.push(`DUP_FRAME:${frame.label}`);
      if (captionBoxBusy) flags.push(`CAPTION_BOX_BUSY:${frame.label}`);
    }
    return { skipped: false, perFrame, flags, thresholds: THRESHOLDS, analysisWidth: ANALYSIS_WIDTH };
  } catch (err) {
    return { skipped: true, reason: err instanceof Error ? err.message.slice(0, 200) : String(err) };
  }
}

/** The `{{PIXEL_STATS}}` block for the critic prompt (PROMPT-PACK §13). */
export function formatPixelStatsForPrompt(stats: PixelStats | null | undefined): string {
  if (!stats) return "PIXEL_STATS: not computed.";
  if (stats.skipped) return `PIXEL_STATS: unavailable (${stats.reason}).`;
  const rows = stats.perFrame.map((f) => {
    const notes: string[] = [];
    if (f.black) notes.push("NEAR-BLACK");
    if (f.sharpness < stats.thresholds.softSharpnessMax && !f.black) notes.push("SOFT (low Laplacian variance)");
    if (f.dupOfPrev) notes.push("DUPLICATE of previous beat frame");
    if (f.captionBoxBusy) notes.push("busy detail around the caption band");
    return `${f.label}: sharpness ${f.sharpness}, mean luma ${f.meanLuma}${notes.length ? ` — ${notes.join("; ")}` : ""}`;
  });
  return [
    "DETERMINISTIC PRE-FLAGS (PIXEL_STATS — computed at $0 from the same frames you see; thresholds are uncalibrated hypotheses, so treat each flag as evidence to CONFIRM OR REFUTE with your own eyes, never as a finding on its own):",
    ...rows,
    `flags: ${stats.flags.length ? stats.flags.join(", ") : "none"}`,
  ].join("\n");
}
