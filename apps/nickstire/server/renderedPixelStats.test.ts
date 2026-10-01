/**
 * Deterministic pixel checks — positive control FIRST.
 *
 * Every instrument here is proven against a planted positive AND a clean
 * negative in the same run: a blurred copy of a sharp frame must score lower;
 * two identical beat frames must read as a duplicate while two different ones
 * must not; a black frame must flag while a grey one must not; noise packed
 * around the caption band must flag while a flat field must not. A check that
 * only ever sees clean input is a silent instrument.
 *
 * Fixtures are synthesised with sharp (the same library the module uses), so
 * the test needs no binary assets and no ffmpeg. The thresholds themselves are
 * HYPOTHESES (see the module header) — these tests pin the ORDERING and the
 * flag behaviour on synthetic frames, not a calibration on real reels.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import sharp from "sharp";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeRenderedPixelStats, formatPixelStatsForPrompt } from "./services/renderedPixelStats";
import { CAPTION_BEAT_Y_FRAC } from "./services/reelAssembly";
import type { ExtractedFrame } from "./services/renderedQa";

const W = 540;
const H = 960;
let dir: string;

/** Deterministic pseudo-random noise (LCG) so the fixture is reproducible. */
function noiseBuffer(seed: number): Buffer {
  const b = Buffer.alloc(W * H);
  let s = seed >>> 0;
  for (let i = 0; i < b.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    b[i] = s >>> 24;
  }
  return b;
}

/** Block noise — coarser than pixel noise, closer to real subject texture
 *  (tread blocks, rust, metal grain) at the module's 270px analysis scale.
 *  Pixel noise averages away under the 2x downscale + JPEG (measured std 33
 *  vs 68 for 4px blocks), which is exactly why the halo check must not be
 *  tuned on it. */
function blockNoiseBuffer(seed: number, block: number): Buffer {
  const b = Buffer.alloc(W * H);
  let s = seed >>> 0;
  for (let y = 0; y < H; y += block) {
    for (let x = 0; x < W; x += block) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const v = s >>> 24;
      for (let yy = y; yy < Math.min(H, y + block); yy++) for (let xx = x; xx < Math.min(W, x + block); xx++) b[yy * W + xx] = v;
    }
  }
  return b;
}

function flatBuffer(value: number): Buffer {
  return Buffer.alloc(W * H, value);
}

async function writeGray(name: string, data: Buffer, blurSigma?: number): Promise<string> {
  const file = path.join(dir, name);
  let img = sharp(data, { raw: { width: W, height: H, channels: 1 } });
  if (blurSigma) img = img.blur(blurSigma);
  await img.jpeg({ quality: 92 }).toFile(file);
  return file;
}

const frame = (label: string, beatNumber: number | null, p: string): ExtractedFrame => ({ label, beatNumber, timestamp: 0, path: p });

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pixel-stats-"));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("sharpness (Laplacian variance)", () => {
  it("POSITIVE CONTROL: a blurred copy of a frame scores LOWER than the sharp original, and only the blur is flagged SOFT", async () => {
    const noise = noiseBuffer(7);
    const sharpPath = await writeGray("sharp.jpg", noise);
    const blurPath = await writeGray("blur.jpg", noise, 6);
    const stats = await computeRenderedPixelStats([frame("beat2", 2, sharpPath), frame("beat3", 3, blurPath)]);
    if (stats.skipped) throw new Error(stats.reason);
    const [a, b] = stats.perFrame;
    expect(a.sharpness).toBeGreaterThan(b.sharpness * 10);
    expect(b.sharpness).toBeLessThan(stats.thresholds.softSharpnessMax);
    expect(a.sharpness).toBeGreaterThan(stats.thresholds.softSharpnessMax);
    expect(stats.flags).toContain("SOFT_FRAME:beat3");
    expect(stats.flags).not.toContain("SOFT_FRAME:beat2");
  });
});

describe("duplicate beat frames", () => {
  it("POSITIVE CONTROL: the same frame twice is a duplicate; a different frame is not", async () => {
    const a = await writeGray("dupA.jpg", noiseBuffer(11));
    const b = await writeGray("dupB.jpg", noiseBuffer(11)); // identical content, separate file
    const c = await writeGray("dupC.jpg", noiseBuffer(12)); // different content
    const stats = await computeRenderedPixelStats([frame("beat1", 1, a), frame("beat2", 2, b), frame("beat3", 3, c)]);
    if (stats.skipped) throw new Error(stats.reason);
    expect(stats.perFrame.map((f) => f.dupOfPrev)).toEqual([false, true, false]);
    expect(stats.flags).toContain("DUP_FRAME:beat2");
    expect(stats.flags).not.toContain("DUP_FRAME:beat3");
  });

  it("first/final frames never count as duplicates — they share a clip with a beat by construction", async () => {
    const a = await writeGray("ff.jpg", noiseBuffer(21));
    const stats = await computeRenderedPixelStats([frame("first", 1, a), frame("beat1", 1, a), frame("final", 1, a)]);
    if (stats.skipped) throw new Error(stats.reason);
    expect(stats.flags.filter((f) => f.startsWith("DUP_FRAME"))).toEqual([]);
  });
});

describe("black frames", () => {
  it("POSITIVE CONTROL: a near-black frame flags; a mid-grey frame does not", async () => {
    const black = await writeGray("black.jpg", flatBuffer(3));
    const grey = await writeGray("grey.jpg", flatBuffer(120));
    const stats = await computeRenderedPixelStats([frame("first", 1, black), frame("beat2", 2, grey)]);
    if (stats.skipped) throw new Error(stats.reason);
    expect(stats.perFrame[0].black).toBe(true);
    expect(stats.perFrame[1].black).toBe(false);
    expect(stats.flags).toContain("BLACK_FRAME:first");
    // A black frame reports ONLY black — a soft/busy flag on nothing is noise.
    expect(stats.flags.filter((f) => f.endsWith(":first"))).toEqual(["BLACK_FRAME:first"]);
  });
});

describe("caption band halo", () => {
  it("POSITIVE CONTROL: dense detail around the beat caption band flags; a flat field does not; detail elsewhere does not", async () => {
    // Busy: noise only in the halo rows around reelAssembly's caption band.
    const busy = flatBuffer(110);
    const noise = blockNoiseBuffer(31, 4);
    const bandTop = Math.round(H * CAPTION_BEAT_Y_FRAC);
    const bandBottom = Math.round(H * (CAPTION_BEAT_Y_FRAC + 0.10));
    const halo = Math.round(H * 0.06);
    for (let y = bandTop - halo; y < bandTop; y++) noise.copy(busy, y * W, y * W, (y + 1) * W);
    for (let y = bandBottom; y < bandBottom + halo; y++) noise.copy(busy, y * W, y * W, (y + 1) * W);
    // Elsewhere: the same noise but in the TOP quarter of the frame only.
    const elsewhere = flatBuffer(110);
    for (let y = 0; y < Math.round(H * 0.25); y++) noise.copy(elsewhere, y * W, y * W, (y + 1) * W);

    const busyPath = await writeGray("busy.jpg", busy);
    const flatPath = await writeGray("flat.jpg", flatBuffer(110));
    const elsewherePath = await writeGray("elsewhere.jpg", elsewhere);
    const stats = await computeRenderedPixelStats([
      frame("beat2", 2, busyPath),
      frame("beat3", 3, flatPath),
      frame("beat4", 4, elsewherePath),
    ]);
    if (stats.skipped) throw new Error(stats.reason);
    expect(stats.perFrame.map((f) => f.captionBoxBusy)).toEqual([true, false, false]);
    expect(stats.flags).toContain("CAPTION_BOX_BUSY:beat2");
  });
});

describe("never throws into the pipeline", () => {
  it("a missing frame file resolves to skipped-with-reason instead of rejecting", async () => {
    const stats = await computeRenderedPixelStats([frame("beat1", 1, path.join(dir, "does-not-exist.jpg"))]);
    expect(stats.skipped).toBe(true);
    if (stats.skipped) expect(stats.reason.length).toBeGreaterThan(0);
  });

  it("no frames resolves to skipped", async () => {
    expect((await computeRenderedPixelStats([])).skipped).toBe(true);
  });
});

describe("prompt block", () => {
  it("renders flags and per-frame rows, and names skipped stats as unavailable (never as clean)", async () => {
    const black = await writeGray("pblack.jpg", flatBuffer(2));
    const stats = await computeRenderedPixelStats([frame("first", 1, black)]);
    const text = formatPixelStatsForPrompt(stats);
    expect(text).toContain("PIXEL_STATS");
    expect(text).toContain("BLACK_FRAME:first");
    expect(text).toContain("CONFIRM OR REFUTE");
    expect(formatPixelStatsForPrompt({ skipped: true, reason: "sharp exploded" })).toContain("unavailable (sharp exploded)");
    expect(formatPixelStatsForPrompt(null)).toContain("not computed");
  });
});
