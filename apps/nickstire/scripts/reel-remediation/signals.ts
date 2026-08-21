/**
 * Shared detection primitives — split out of detect.ts so Phase 4's QC gate
 * can literally re-run the SAME frame check Phase 1 used to find these reels
 * in the first place ("re-run Phase-1 pHash to confirm NO stock frames
 * survived", mission Phase 4 step 7), rather than a re-implementation that
 * could silently drift from what Phase 1 actually checks.
 *
 * WHAT THIS MEASURES, AND WHY IT IS NOT AVERAGE COLOUR (fixed 2026-08-21).
 *
 * The first version sampled the frame down to a single pixel and compared that
 * average against templateStockStudio's known palette (a near-black base plus
 * four sweep tones) within an RGB radius of 40. That is a broken instrument,
 * and Phase 4 proved it: every one of the first three successfully regenerated
 * reels was REJECTED by QC as "still matches the synthetic lane's palette"
 * while carrying genuine Higgsfield CDN clips.
 *
 * The reason is that the brief's own art direction is "graphite black and deep
 * shadow tones with gold accents" — the REAL footage is legitimately dark, so
 * its average colour lands right next to the synthetic lane's average colour.
 * Measured on one known clip of each class:
 *
 *   stock (synthetic) 1x1 average = rgb(29,24,23)
 *   real  (higgsfield) 1x1 average = rgb(38,35,28)
 *
 * Nine RGB units apart, inside a radius-40 match. Averaging to 1x1 destroys
 * precisely the information that separates the two classes.
 *
 * The actual discriminator is SPATIAL VARIANCE. The synthetic lane is an
 * animated gradient by construction (templateStockStudio.ts) — nearly uniform
 * across the frame. Real generated footage is detailed imagery with
 * highlights, texture and depth. Same two clips, sampled 16x16 and measured on
 * luma:
 *
 *   stock (synthetic) std-dev =  2.8, range =  15.8
 *   real  (higgsfield) std-dev = 36.2, range = 207.1
 *
 * A 13x separation on both statistics, versus no usable separation at all from
 * the average. SYNTHETIC_LUMA_STDDEV_MAX sits at 12 — over 4x the observed
 * synthetic value and 3x below the observed real value, so both classes clear
 * it with a wide margin rather than sitting on a knife edge.
 */

/** Frames flatter than this (luma std-dev over a 16x16 sample) are the
 *  synthetic gradient lane. See the file header for the measured basis. */
export const SYNTHETIC_LUMA_STDDEV_MAX = 12;

/** Sample grid edge. 1 was the bug — it averages away the signal. */
const SAMPLE_EDGE = 16;

export interface FrameSignature {
  /** Mean luma 0-255. Reported for context; NOT the discriminator. */
  meanLuma: number;
  /** Std-dev of luma across the sample grid — the actual discriminator. */
  stdDevLuma: number;
  /** max-min luma across the grid, a second view of the same property. */
  rangeLuma: number;
}

/**
 * Grab one frame at t=1s, downscale to SAMPLE_EDGE^2 and return its luma
 * statistics. Null when the frame could not be read at all (ffmpeg missing,
 * URL unreachable, timeout) — callers must treat null as UNKNOWN and abstain,
 * never as a pass or a fail.
 */
export async function sampleFrameSignature(clipUrl: string): Promise<FrameSignature | null> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const ff = spawn("ffmpeg", [
      "-ss", "1", "-i", clipUrl,
      "-vframes", "1", "-vf", `scale=${SAMPLE_EDGE}:${SAMPLE_EDGE}`,
      "-f", "rawvideo", "-pix_fmt", "rgb24",
      "pipe:1",
    ], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    ff.stdout.on("data", (c) => chunks.push(c));
    ff.on("error", () => resolve(null));
    ff.on("close", (code) => {
      const buf = Buffer.concat(chunks);
      const need = SAMPLE_EDGE * SAMPLE_EDGE * 3;
      if (code !== 0 || buf.length < need) { resolve(null); return; }
      const luma: number[] = [];
      for (let i = 0; i + 2 < need; i += 3) {
        // Rec.709 luma — perceptual brightness, so a bright gold accent counts
        // for more than an equally-valued blue, matching what "detail" looks
        // like to a viewer.
        luma.push(0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]);
      }
      const mean = luma.reduce((a, b) => a + b, 0) / luma.length;
      const stdDev = Math.sqrt(luma.reduce((a, b) => a + (b - mean) ** 2, 0) / luma.length);
      resolve({
        meanLuma: Number(mean.toFixed(1)),
        stdDevLuma: Number(stdDev.toFixed(1)),
        rangeLuma: Number((Math.max(...luma) - Math.min(...luma)).toFixed(1)),
      });
    });
    setTimeout(() => { try { ff.kill(); } catch { /* already gone */ } resolve(null); }, 30_000);
  });
}

/** True when the frame is flat enough to be the synthetic gradient lane. */
export function frameLooksSynthetic(sig: FrameSignature): boolean {
  return sig.stdDevLuma < SYNTHETIC_LUMA_STDDEV_MAX;
}

export function extractStockAssets(clipUrlsJson: string | null | undefined): string[] {
  if (!clipUrlsJson) return [];
  try {
    const arr = JSON.parse(clipUrlsJson);
    if (!Array.isArray(arr)) return [];
    return arr.filter((u) => typeof u === "string" && u.includes("template-stock"));
  } catch {
    return [];
  }
}
