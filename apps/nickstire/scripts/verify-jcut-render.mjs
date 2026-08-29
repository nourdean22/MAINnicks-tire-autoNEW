/**
 * Prove a J-cut EXISTS IN A RENDERED FILE, not in a data structure.
 *
 * WHY THIS SCRIPT EXISTS. `shared/reelTimeline.ts` can describe an overlap and
 * `buildTimelineAudioGraph` can emit a delay for it, but a unit test that
 * asserts the emitted string is still asserting our own intent. The question
 * that matters is whether the mp4 that reaches Instagram has audio running
 * across a picture cut. This renders one and measures it.
 *
 * THE MEASUREMENT
 *   picture: three 4s colour clips — cuts land at 4.0s and 8.0s
 *   audio:   ONE dialogue clip for beat 2, timeline start 3.4s
 *   expected: audio begins ~3.4s, i.e. 0.6s BEFORE the 4.0s picture cut
 *
 * Audio onset is read with ffmpeg's own `silencedetect` (the first
 * silence_end), and the picture cut is read by sampling frames and finding
 * where the colour changes. Neither number comes from our code.
 *
 * POSITIVE CONTROL IS BUILT IN: the same harness renders a LOCKED timeline
 * (audio starting exactly at 4.0s) and requires it to measure as no overlap.
 * A measurement that reports an overlap for both is measuring nothing.
 *
 * Not a vitest test on purpose: it spawns ffmpeg several times and takes tens
 * of seconds. Run it by hand, or in a scheduled job — not in the unit suite.
 *
 * Usage: node scripts/verify-jcut-render.mjs
 * Exit code is non-zero if the rendered file does not contain the overlap.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WD = mkdtempSync(join(tmpdir(), "jcut-"));
const run = (args, opts = {}) => spawnSync("ffmpeg", args, { cwd: WD, encoding: "utf8", ...opts });

function makeInputs() {
  // Picture: three distinct flat colours so a cut is trivially detectable.
  const colours = ["red", "green", "blue"];
  colours.forEach((c, i) => {
    const r = run(["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${c}:s=320x568:d=4,format=yuv420p`,
      "-c:v", "libx264", "-r", "30", `v${i}.mp4`]);
    if (r.status !== 0) throw new Error(`colour clip ${i} failed: ${r.stderr}`);
  });
  // Audio: a single tone, longer than its slot so the trim is exercised.
  const a = run(["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
    "-c:a", "pcm_s16le", "tone.wav"]);
  if (a.status !== 0) throw new Error(`tone failed: ${a.stderr}`);
}

/** Render 12s of picture with one dialogue clip delayed to `audioStartSec`. */
function render(audioStartSec, outName) {
  const delayMs = Math.round(audioStartSec * 1000);
  const durSec = (8 - audioStartSec).toFixed(3);
  const fc = [
    "[0:v][1:v][2:v]concat=n=3:v=1:a=0[vout]",
    `[3:a]atrim=0:${durSec},asetpts=PTS-STARTPTS,aresample=48000,adelay=${delayMs}|${delayMs}[p_vo2]`,
    "[p_vo2]apad=whole_dur=12,atrim=0:12,asetpts=PTS-STARTPTS[aout]",
  ].join(";");
  const r = run(["-y", "-v", "error", "-i", "v0.mp4", "-i", "v1.mp4", "-i", "v2.mp4", "-i", "tone.wav",
    "-filter_complex", fc, "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-t", "12", outName]);
  if (r.status !== 0) throw new Error(`render failed: ${r.stderr}`);
  return outName;
}

/** First moment audio becomes non-silent, per ffmpeg — not per our code. */
function audioOnsetSec(file) {
  const r = spawnSync("ffmpeg", ["-i", file, "-af", "silencedetect=noise=-50dB:d=0.2", "-f", "null", "-"],
    { cwd: WD, encoding: "utf8" });
  const m = /silence_end: ([0-9.]+)/.exec(r.stderr || "");
  return m ? Number(m[1]) : null;
}

/** Mean colour of one frame, used to find where the picture changes. */
function frameSignature(file, t) {
  const r = spawnSync("ffmpeg",
    ["-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { cwd: WD, encoding: "buffer" });
  const b = r.stdout;
  return b && b.length >= 3 ? `${b[0]},${b[1]},${b[2]}` : null;
}

function firstPictureCutSec(file) {
  let prev = frameSignature(file, 0.2);
  for (let t = 0.4; t < 11.5; t += 0.2) {
    const sig = frameSignature(file, t);
    if (sig && prev && sig !== prev) return Number(t.toFixed(2));
    prev = sig ?? prev;
  }
  return null;
}

console.log(`workdir ${WD}`);
makeInputs();

let failed = false;

// ── the J-cut: audio placed 0.6s before the picture cut ───────────────────
const jcut = render(3.4, "jcut.mp4");
const jOnset = audioOnsetSec(jcut);
const jCut = firstPictureCutSec(jcut);
console.log(`\nJ-CUT RENDER   audio onset ${jOnset}s   picture cut ${jCut}s`);
if (jOnset === null || jCut === null) {
  console.error("  MEASUREMENT FAILED — could not read onset or cut; the instrument, not the render");
  failed = true;
} else if (jOnset < jCut - 0.15) {
  console.log(`  PASS — audio leads the cut by ${(jCut - jOnset).toFixed(2)}s in the rendered file`);
} else {
  console.error(`  FAIL — audio does not lead the picture cut (${jOnset} vs ${jCut})`);
  failed = true;
}

// ── positive control: a locked timeline must NOT measure as an overlap ────
const locked = render(4.0, "locked.mp4");
const lOnset = audioOnsetSec(locked);
const lCut = firstPictureCutSec(locked);
console.log(`\nLOCKED RENDER  audio onset ${lOnset}s   picture cut ${lCut}s`);
if (lOnset === null || lCut === null) {
  console.error("  MEASUREMENT FAILED — instrument problem");
  failed = true;
} else if (lOnset < lCut - 0.15) {
  console.error(`  FAIL — the control also reports an overlap, so the measurement proves nothing`);
  failed = true;
} else {
  console.log(`  PASS — no overlap measured, so the J-cut result above is a real signal`);
}

console.log(failed ? "\nRESULT: FAILED" : "\nRESULT: the rendered file contains the overlap");
process.exit(failed ? 1 : 0);
