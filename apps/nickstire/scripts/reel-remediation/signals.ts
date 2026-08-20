/**
 * Shared detection primitives — split out of detect.ts so Phase 4's QC gate
 * can literally re-run the SAME frame-signature check Phase 1 used to find
 * these reels in the first place ("re-run Phase-1 pHash to confirm NO stock
 * frames survived", mission Phase 4 step 7), rather than a re-implementation
 * that could silently drift from what Phase 1 actually checks.
 */

export const BASE_DARK = { r: 0x0b, g: 0x0b, b: 0x0f };
export const SWEEP_TONES = [
  { r: 0x1c, g: 0x1c, b: 0x26 },
  { r: 0x20, g: 0x1a, b: 0x16 },
  { r: 0x16, g: 0x20, b: 0x2a },
  { r: 0x24, g: 0x1c, b: 0x24 },
];
/** Euclidean RGB distance a synthetic frame's average color must fall within. */
export const PALETTE_MATCH_RADIUS = 40;

export async function sampleFrameAverageColor(clipUrl: string): Promise<{ r: number; g: number; b: number } | null> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    // -vframes 1 at t=1s, downscaled to 1x1 so ffmpeg's own scaler averages
    // the whole frame for us; rawvideo rgb24 to stdout is exactly 3 bytes.
    const ff = spawn("ffmpeg", [
      "-ss", "1", "-i", clipUrl,
      "-vframes", "1", "-vf", "scale=1:1",
      "-f", "rawvideo", "-pix_fmt", "rgb24",
      "pipe:1",
    ], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    ff.stdout.on("data", (c) => chunks.push(c));
    ff.on("error", () => resolve(null));
    ff.on("close", (code) => {
      const buf = Buffer.concat(chunks);
      if (code !== 0 || buf.length < 3) { resolve(null); return; }
      resolve({ r: buf[0], g: buf[1], b: buf[2] });
    });
    setTimeout(() => { try { ff.kill(); } catch {} resolve(null); }, 20_000);
  });
}

function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

export function matchesSyntheticPalette(color: { r: number; g: number; b: number }): boolean {
  const palette = [BASE_DARK, ...SWEEP_TONES];
  return palette.some((p) => colorDistance(color, p) <= PALETTE_MATCH_RADIUS);
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
