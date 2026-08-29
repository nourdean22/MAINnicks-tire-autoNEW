/**
 * Prove a J-cut EXISTS IN A RENDERED FILE, produced by OUR filtergraph.
 *
 * ── WHAT THE PREVIOUS VERSION PROVED, AND WHY IT WAS NOT ENOUGH ─────────────
 * `verify-jcut-render.mjs` mentioned `buildTimelineAudioGraph` in this header
 * and then hand-wrote its own `adelay` string. It rendered two real mp4s and
 * measured them honestly, so its numbers were sound — but they were numbers
 * about ffmpeg, not about us. It would have passed identically if
 * `buildTimelineAudioGraph` returned an empty array, because the render never
 * called it. A proof that cannot fail when the subject breaks is not a proof
 * of the subject.
 *
 * This version imports the real function and renders exactly what it emits.
 * The measurement is unchanged and still comes from ffmpeg, not from us.
 *
 * ── WHY THIS IS .ts AND RUN WITH tsx ────────────────────────────────────────
 * The subject is a TypeScript module. A plain .mjs cannot import it, which is
 * the most likely reason the original hand-wrote the graph rather than calling
 * it. `tsx` is already a dependency, so the barrier was removable.
 *
 * ── THE MEASUREMENT ─────────────────────────────────────────────────────────
 *   picture: three 4s colour clips - cuts land at 4.0s and 8.0s
 *   audio:   ONE dialogue clip for beat 2, timeline start 3.4s
 *   expected: audio begins ~3.4s, i.e. 0.6s BEFORE the 4.0s picture cut
 *
 * Audio onset is read with ffmpeg's own `silencedetect`; the picture cut is
 * read by sampling frames for a colour change. Neither number comes from our
 * code — only the filtergraph does.
 *
 * POSITIVE CONTROL IS BUILT IN: the same harness renders a LOCKED timeline
 * (audio starting exactly at 4.0s) through the SAME function and requires it
 * to measure as no overlap. A measurement reporting an overlap for both is
 * measuring nothing. `machineCadenceProblem` is asserted on both timelines
 * too, so our craft rule and the rendered file have to agree.
 *
 * Not a vitest test on purpose: it spawns ffmpeg many times and takes tens of
 * seconds. Run by hand or in a scheduled job.
 *
 * Usage: pnpm exec tsx scripts/verify-jcut-render.ts
 * Exit code is non-zero if the rendered file does not contain the overlap.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildTimelineAudioGraph } from "../shared/reelAudioMix";
import { machineCadenceProblem, timelineProblem, type ReelTimeline } from "../shared/reelTimeline";

const WD = mkdtempSync(join(tmpdir(), "jcut-"));
const run = (args: string[]) => spawnSync("ffmpeg", args, { cwd: WD, encoding: "utf8" });

const TOTAL_SEC = 12;
/** Index of the tone input in the ffmpeg command below. */
const AUDIO_INPUT_LABEL = "3:a";

function makeInputs(): void {
  // Picture: three distinct flat colours so a cut is trivially detectable.
  ["red", "green", "blue"].forEach((c, i) => {
    const r = run(["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${c}:s=320x568:d=4,format=yuv420p`,
      "-c:v", "libx264", "-r", "30", `v${i}.mp4`]);
    if (r.status !== 0) throw new Error(`colour clip ${i} failed: ${r.stderr}`);
  });
  // Audio: a single tone, longer than its slot so the trim is exercised.
  const a = run(["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
    "-c:a", "pcm_s16le", "tone.wav"]);
  if (a.status !== 0) throw new Error(`tone failed: ${a.stderr}`);
}

/**
 * A three-beat timeline whose single dialogue clip starts at `audioStartSec`.
 * At 3.4 that is a J-cut against the 4.0s picture cut; at 4.0 it is locked.
 */
function timelineWithAudioAt(audioStartSec: number): ReelTimeline {
  return {
    durationSec: TOTAL_SEC,
    picture: [
      { id: "b1", storyFunction: "hook", shotScale: "wide", motion: "static", startSec: 0, endSec: 4 },
      { id: "b2", storyFunction: "turn", shotScale: "close", motion: "push_in", startSec: 4, endSec: 8 },
      { id: "b3", storyFunction: "ask", shotScale: "medium", motion: "static", startSec: 8, endSec: 12 },
    ],
    audio: [{ id: "d1", bus: "dialogue", startSec: audioStartSec, endSec: 8, beatId: "b2" }],
    music: [],
    silence: [],
    graphics: [],
  };
}

/** Render through the REAL graph. Returns the filename and the fragments used. */
function render(timeline: ReelTimeline, outName: string): { file: string; fragments: string[] } {
  const graph = buildTimelineAudioGraph(timeline, { d1: AUDIO_INPUT_LABEL });
  if (!graph) throw new Error("buildTimelineAudioGraph returned null - nothing to render");

  const fc = ["[0:v][1:v][2:v]concat=n=3:v=1:a=0[vout]", ...graph.fragments].join(";");
  const r = run(["-y", "-v", "error", "-i", "v0.mp4", "-i", "v1.mp4", "-i", "v2.mp4", "-i", "tone.wav",
    "-filter_complex", fc, "-map", "[vout]", "-map", `[${graph.outLabel}]`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-t", String(TOTAL_SEC), outName]);
  if (r.status !== 0) throw new Error(`render failed:\n  graph: ${fc}\n  ffmpeg: ${r.stderr}`);
  return { file: outName, fragments: graph.fragments };
}

/** First moment audio becomes non-silent, per ffmpeg — not per our code. */
function audioOnsetSec(file: string): number | null {
  const r = spawnSync("ffmpeg", ["-i", file, "-af", "silencedetect=noise=-50dB:d=0.2", "-f", "null", "-"],
    { cwd: WD, encoding: "utf8" });
  const m = /silence_end: ([0-9.]+)/.exec(r.stderr || "");
  return m ? Number(m[1]) : null;
}

/** Mean colour of one frame, used to find where the picture changes. */
function frameSignature(file: string, t: number): string | null {
  const r = spawnSync("ffmpeg",
    ["-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { cwd: WD, encoding: "buffer" });
  const b = r.stdout;
  return b && b.length >= 3 ? `${b[0]},${b[1]},${b[2]}` : null;
}

function firstPictureCutSec(file: string): number | null {
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

const jTimeline = timelineWithAudioAt(3.4);
const lTimeline = timelineWithAudioAt(4.0);

// ── our own rules must agree with what we are about to render ─────────────
for (const [name, t, wantCadenceProblem] of [
  ["J-cut", jTimeline, false],
  ["locked", lTimeline, true],
] as const) {
  const structural = timelineProblem(t);
  if (structural) {
    console.error(`  ${name} timeline is not renderable: ${structural}`);
    failed = true;
  }
  const cadence = machineCadenceProblem(t);
  if (wantCadenceProblem && !cadence) {
    console.error(`  ${name} timeline should have been flagged as machine cadence and was not`);
    failed = true;
  }
  if (!wantCadenceProblem && cadence) {
    console.error(`  ${name} timeline was wrongly flagged as machine cadence: ${cadence}`);
    failed = true;
  }
}

// ── the J-cut: audio placed 0.6s before the picture cut ───────────────────
const jcut = render(jTimeline, "jcut.mp4");
console.log(`\nGRAPH EMITTED BY buildTimelineAudioGraph (${jcut.fragments.length} fragments):`);
jcut.fragments.forEach((f) => console.log(`  ${f}`));

const jOnset = audioOnsetSec(jcut.file);
const jCut = firstPictureCutSec(jcut.file);
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
const locked = render(lTimeline, "locked.mp4");
const lOnset = audioOnsetSec(locked.file);
const lCut = firstPictureCutSec(locked.file);
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
