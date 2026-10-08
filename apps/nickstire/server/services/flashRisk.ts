/**
 * Photosensitive flash check for rendered reels (2026-10-08).
 *
 * WHY. Rendered QA looks at one frame per beat, so it cannot see anything that
 * happens between frames — and the one defect that is a safety issue rather
 * than a taste issue lives exactly there: flashing. WCAG 2.2 SC 2.3.1 ("Three
 * Flashes or Below Threshold") treats more than three general flashes in any
 * one-second period as a seizure risk. Faceless reels lean on punch-ins, strobe
 * cuts and white-flash transitions, so this is a real exposure, not a theory.
 *
 * HOW. One extra ffmpeg pass samples the master at 15 fps on a tiny grayscale
 * copy and reads each frame's average luma (signalstats YAVG). The analysis is
 * pure: luma → relative luminance (sRGB linearisation of the average, a proxy),
 * then a general flash is a pair of opposing luminance changes of at least 0.1
 * where the darker state is below 0.8 (the WCAG 2.2 definition). More than
 * three flashes inside any one-second window fails.
 *
 * LIMIT, STATED. Whole-frame average luminance is CONSERVATIVE toward passing:
 * a flash covering a quarter of the frame moves the average by a quarter as
 * much and can slip under the threshold. It catches full-frame strobes and
 * flash transitions — the shapes this pipeline actually produces — and is not a
 * substitute for a PEAT-style area analysis. Red-flash (saturated red) is not
 * measured at all.
 */
import { spawn } from "node:child_process";

export const FLASH_SAMPLE_FPS = 15;
export const MAX_FLASHES_PER_SECOND = 3;

export interface FlashRisk {
  /** Most general flashes found in any one-second window. */
  maxFlashesPerSecond: number;
  /** Second (from the start) where that window begins, or null when none. */
  worstWindowStartSec: number | null;
  fail: boolean;
  framesAnalysed: number;
}

/** sRGB 8-bit luma (16–235 or 0–255) → approximate relative luminance 0–1. */
function relativeLuminance(y: number): number {
  const v = Math.min(1, Math.max(0, y / 255));
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/**
 * Pure. `luma` is one average-luma value per sampled frame at `fps`.
 * A transition is a monotone run between turning points whose swing is at
 * least 0.1 relative luminance with its darker end below 0.8; two opposing
 * transitions make one flash, timed at the second transition's end.
 */
export function flashRiskFromLuma(luma: number[], fps: number = FLASH_SAMPLE_FPS): FlashRisk {
  const L = luma.map(relativeLuminance);
  // Turning points of the luminance curve: wherever its direction reverses.
  // Flat stretches carry no direction and never split a run.
  const pts: Array<{ i: number; v: number }> = L.length ? [{ i: 0, v: L[0] }] : [];
  let dir = 0;
  for (let i = 1; i < L.length; i++) {
    const d = Math.sign(L[i] - L[i - 1]);
    if (d === 0) continue;
    if (dir !== 0 && d !== dir) pts.push({ i: i - 1, v: L[i - 1] });
    dir = d;
  }
  if (L.length > 1) pts.push({ i: L.length - 1, v: L[L.length - 1] });
  const transitions: Array<{ endFrame: number; dir: number }> = [];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1].v;
    const b = pts[k].v;
    if (Math.abs(b - a) >= 0.1 && Math.min(a, b) < 0.8) transitions.push({ endFrame: pts[k].i, dir: Math.sign(b - a) });
  }
  const flashTimes: number[] = [];
  for (let k = 1; k < transitions.length; k++) {
    if (transitions[k].dir !== transitions[k - 1].dir) {
      flashTimes.push(transitions[k].endFrame / fps);
      k++; // a transition belongs to one flash only
    }
  }
  let max = 0;
  let worst: number | null = null;
  for (let s = 0; s < flashTimes.length; s++) {
    let n = 0;
    while (s + n < flashTimes.length && flashTimes[s + n] - flashTimes[s] < 1) n++;
    if (n > max) { max = n; worst = flashTimes[s]; }
  }
  return { maxFlashesPerSecond: max, worstWindowStartSec: worst, fail: max > MAX_FLASHES_PER_SECOND, framesAnalysed: luma.length };
}

/** Run the one ffmpeg pass and analyse it. Rejects when ffmpeg fails. */
export async function scanFlashRisk(mp4Path: string, ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg"): Promise<FlashRisk> {
  const luma = await new Promise<number[]>((resolve, reject) => {
    const args = [
      "-hide_banner", "-nostats", "-i", mp4Path,
      "-vf", `fps=${FLASH_SAMPLE_FPS},scale=64:-2,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
      "-an", "-f", "null", "-",
    ];
    const p = spawn(ffmpegBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
    const timer = setTimeout(() => p.kill("SIGKILL"), 120_000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffmpeg flash scan exited ${code}: ${err.slice(-300)}`));
      const values = [...out.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
      if (!values.length) return reject(new Error("ffmpeg flash scan produced no luma samples"));
      resolve(values);
    });
  });
  return flashRiskFromLuma(luma);
}
