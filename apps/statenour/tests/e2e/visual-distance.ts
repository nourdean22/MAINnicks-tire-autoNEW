/**
 * visual-distance · "can you tell them apart from six feet away?" (2026-09-16, W7)
 *
 * The Visible Transformation gate compares a fresh page render against the
 * committed PRE-wave baseline and demands that they differ — the inverse of
 * a snapshot test. The measure has to survive two facts about this UI:
 *
 *   1. The house palette is void-black with a narrow content column, so a
 *      real page is 2.5–10% ink (measured on the 2026-09-16 baselines). A
 *      "share of pixels that changed" is therefore capped near the ink of
 *      the two renders combined — a 30% absolute bar was unreachable by any
 *      redesign, and a 5% one is met by re-centering the column.
 *   2. A pure translation (a 64px rail pushing the column right, 16px more
 *      padding) moves every ink pixel. Pixel-for-pixel comparison, absolute
 *      or ink-relative, reads a shift as a redesign (measured: 82–91% of
 *      ink pixels "changed" on a 64×16px shift of the baseline).
 *
 * So the distance is measured on INK MASS at six-feet resolution, and it is
 * REGISTERED: each render is reduced to a grid of `cellPx`-wide cells (48 CSS
 * px — a text line is a fraction of a cell, a display heading fills one), each
 * cell holding its mean luminance; the distance is the relative L1 between
 * the two grids (Σ|a−b| / Σ max(a,b)), minimised over translations of up to
 * `reach` cells in each axis. A page that merely slid keeps its mass map and
 * scores low; a page whose hierarchy, density or composition changed cannot
 * be slid back into place and scores high. Identical renders score 0.
 *
 * Calibration (2026-09-16, hermetic stack, five flagship pages × two viewports):
 *   · pre-wave baseline shifted 32×16px / 64×40px (desktop) or 16 / 40px
 *     (phone): 11.4–26.4%
 *   · the recomposed Home and Missions pages vs their baselines: 49.8–60.8%
 *
 * `sharp` is not a dependency of this app; it is resolved through `next`
 * exactly as scripts/generate-pwa-icons.ts does (precedent since #2339).
 */
import { createRequire } from "node:module";

interface SharpLike {
  (input: Buffer): {
    resize(opts: { width: number; height: number; fit: "fill"; kernel?: "cubic" }): {
      grayscale(): { raw(): { toBuffer(opts: { resolveWithObject: true }): Promise<{ data: Buffer }> } };
    };
  };
}

let sharpModule: SharpLike | null = null;

function loadSharp(): SharpLike {
  if (sharpModule) return sharpModule;
  const requireFromNext = createRequire(require.resolve("next/package.json"));
  const mod = requireFromNext("sharp") as SharpLike | { default: SharpLike };
  sharpModule = ("default" in mod ? mod.default : mod) as SharpLike;
  return sharpModule;
}

export interface DistanceOptions {
  /** Cell size in CSS px of the viewport the render was taken at. Default 48. */
  cellPx?: number;
  /** Registration reach in cells per axis. Default 2 (≈ ±96 CSS px). */
  reach?: number;
}

export interface Distance {
  /** 0..1 relative L1 distance between the two ink-mass grids, best registration. */
  ratio: number;
  /** Grid dimensions the renders were reduced to. */
  cols: number;
  rows: number;
  /** The translation (in cells) at which the two grids matched best. */
  shift: { dx: number; dy: number };
}

export interface MassGrid {
  data: Float64Array;
  cols: number;
  rows: number;
}

/** Reduce a PNG to its six-feet-away ink-mass grid (mean luminance per cell). */
export async function massGrid(
  png: Buffer,
  viewport: { width: number; height: number },
  cellPx = 48,
): Promise<MassGrid> {
  const cols = Math.max(1, Math.round(viewport.width / cellPx));
  const rows = Math.max(1, Math.round(viewport.height / cellPx));
  const sharp = loadSharp();
  const { data } = await sharp(png)
    .resize({ width: cols, height: rows, fit: "fill", kernel: "cubic" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: Float64Array.from(data), cols, rows };
}

/** Relative L1 between two mass grids, minimised over translations of up to `reach` cells. */
export function gridDistance(a: MassGrid, b: MassGrid, reach = 2): Distance {
  let best = { ratio: Number.POSITIVE_INFINITY, dx: 0, dy: 0 };
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      let num = 0;
      let den = 0;
      for (let y = 0; y < a.rows; y++) {
        for (let x = 0; x < a.cols; x++) {
          const sx = x + dx;
          const sy = y + dy;
          const va = a.data[y * a.cols + x];
          const vb = sx >= 0 && sx < b.cols && sy >= 0 && sy < b.rows ? b.data[sy * b.cols + sx] : 0;
          num += Math.abs(va - vb);
          den += Math.max(va, vb);
        }
      }
      const ratio = den === 0 ? 0 : num / den;
      if (ratio < best.ratio) best = { ratio, dx, dy };
    }
  }
  return { ratio: best.ratio, cols: a.cols, rows: a.rows, shift: { dx: best.dx, dy: best.dy } };
}

/** Registered ink-mass distance between two PNG renders of the same viewport. */
export async function visualDistance(
  a: Buffer,
  b: Buffer,
  viewport: { width: number; height: number },
  opts: DistanceOptions = {},
): Promise<Distance> {
  const cellPx = opts.cellPx ?? 48;
  const [ga, gb] = await Promise.all([massGrid(a, viewport, cellPx), massGrid(b, viewport, cellPx)]);
  return gridDistance(ga, gb, opts.reach ?? 2);
}

/** Share of pixels that are not near-black — a page that failed to render is (almost) all void. */
export async function inkCoverage(png: Buffer, viewport: { width: number; height: number }): Promise<number> {
  const width = 320;
  const height = Math.max(1, Math.round((width * viewport.height) / viewport.width));
  const sharp = loadSharp();
  const { data } = await sharp(png)
    .resize({ width, height, fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let ink = 0;
  for (let i = 0; i < data.length; i++) if (data[i] > 28) ink += 1;
  return ink / data.length;
}
