/**
 * admin-v1-distance · "can you tell them apart from six feet away?" (2026-10-16, admin UI v1 W0b)
 *
 * Port of the bdnick instrument (apps/statenour/tests/e2e/visual-distance.ts,
 * 2026-09-16). Mechanism copied, scopes not: this file measures the nickstire
 * admin, whose current render is black and gold with a narrow content column,
 * the same ink-on-void shape the statenour measure was calibrated on.
 *
 * The v1 gate compares a fresh admin render against the FROZEN pre-W1 render
 * and demands that they differ: the inverse of a snapshot test. The measure has
 * to survive two facts about a dark UI:
 *
 *   1. A dark page is mostly void, so "share of pixels that changed" is capped
 *      near the ink of the two renders combined. An absolute pixel bar is either
 *      unreachable by any redesign or met by re-centering one column.
 *   2. A pure translation (a 64 px rail pushing the column right, 16 px more
 *      padding) moves every ink pixel. Pixel-for-pixel comparison reads a shift
 *      as a redesign (statenour measured 82 to 91% of ink pixels "changed" on a
 *      64x16 px shift).
 *
 * So the distance is measured on INK MASS at six-feet resolution, and it is
 * REGISTERED: each render is reduced to a grid of `cellPx`-wide cells (48 CSS
 * px: a text line is a fraction of a cell, a display heading fills one), each
 * cell holding its mean luminance; the distance is the relative L1 between the
 * two grids (sum|a-b| / sum max(a,b)), minimised over translations of up to
 * `reach` cells in each axis. A page that merely slid keeps its mass map and
 * scores low; a page whose hierarchy, density or composition changed cannot be
 * slid back into place and scores high. Identical renders score 0.
 *
 * Statenour calibration (2026-09-16): shifted 11.4 to 26.4%, recomposed 49.8 to
 * 60.8%, threshold 0.35. Here the controls ASSERT their thresholds rather than
 * record numbers: admin-v1-distance.test.ts (synthetic: identical 0, slides under
 * 0.35, recomposed above 0.35, the cell size, registration and luminance pinned)
 * and admin-v1-gate.spec.ts (real renders: re-render under 0.02, slides under
 * 0.35, a different page above the 0.30 real-render floor). The threshold stays
 * 0.35 unless those controls say it cannot.
 *
 * Not ported: statenour's `inkCoverage` (its "page failed to render" check). The
 * admin specs prove the render instead, by waiting for a DEMO row and failing on
 * any unstubbed read or first-party error.
 *
 * PNG decoding: `sharp`, the decoder the statenour module uses. Here it is a
 * direct dependency of this app (package.json), so no resolve-through-next. It is
 * imported lazily, inside massGrid, so a Playwright run that merely COLLECTS the
 * specs (the live canary job collects every *.spec.ts) never loads it.
 */

export interface DistanceOptions {
  /** Cell size in CSS px of the viewport the render was taken at. Default 48. */
  cellPx?: number;
  /** Registration reach in cells per axis. Default 2 (about +-96 CSS px). */
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
  const { default: sharp } = await import("sharp");
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
