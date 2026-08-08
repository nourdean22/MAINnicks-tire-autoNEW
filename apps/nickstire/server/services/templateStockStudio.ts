/**
 * templateStockStudio — the CHEAP reel clip lane.
 *
 * Veo and Higgsfield both bill per clip (seedance ~$0.25/clip; a reel is 5-6
 * beats). This produces a beat clip with ffmpeg alone: zero API cost, zero
 * credentials, and it runs when every paid provider is dead. It is the lane for
 * volume — draft-first experiments, hook tests, evergreen explainers — while the
 * paid lanes stay for hero pieces.
 *
 * SHAPE CONTRACT: a drop-in sibling of higgsfieldStudio.generateReelClipVideo —
 * one call per beat, returns ONE public http URL for that beat's clip.
 * Everything downstream (progressive clipUrls persistence, assembly, VO,
 * rendered QA, inventory draft, publish gates) is reused untouched.
 *
 * THE CLIP CARRIES NO TEXT, deliberately. reelAssembly already burns each
 * beat's `onScreenText` over the stitched clips (reelAssembly.ts:179), so
 * drawing text here produced TWO caption layers. Worse, the value this lane
 * receives per beat is `promptPack.prompt ?? beat.visual` — a provider
 * scene-generation INSTRUCTION, not viewer-facing copy — so burning it in
 * exposed internal prompts on screen. This lane's job is the moving backdrop;
 * captions belong to assembly, which owns them for every provider.
 *
 * NOT a "static video": Instagram's content-monetization policy explicitly
 * restricts static videos and text montages, so every clip carries real motion.
 * A still gets one of SIX camera moves (see BeatMotion) rotating deterministically
 * per beat; without a still it gets an animated gradient whose tone, sweep angle
 * and speed all vary per beat. Both paths exist so a 5-6 beat reel is never N
 * identical backdrops — repetition is what makes an asset read generic, and
 * HARD_REJECT_RULES[0] is exactly "generic mechanic imagery any shop could run
 * unchanged".
 */
import { spawn } from "child_process";
import { createLogger } from "../lib/logger";
import { MAX_CLIP_SECONDS } from "./reelAssembly";

const log = createLogger("services:template-stock");

/** Near-black base; assembly's caption box sits on top of this. */
const BASE_DARK = "0x0B0B0F";
/** Sweep targets, cycled per beat so consecutive backdrops differ. */
const SWEEP_TONES = ["0x1C1C26", "0x201A16", "0x16202A", "0x241C24"] as const;

const FRAME_W = 1080;
const FRAME_H = 1920;
const FPS = 30;

/**
 * Camera moves for a still (2026-08-07).
 *
 * Before this there was exactly ONE: a slow push-in. A reel is 5-6 beats, so a
 * still-backed reel was N identical Ken Burns pushes — which reads as filler
 * even when each individual clip is technically fine. `HARD_REJECT_RULES[0]`
 * ("generic mechanic imagery any shop could run unchanged") is the standard
 * this lane has to clear, and repetition is what makes an asset read generic.
 *
 * Every expression is SPACE-FREE and `on`-based (output frame number) rather
 * than `zoom`-based wherever the ramp must be predictable — `zoom` refers to the
 * previous frame's value, which compounds and is hard to reason about at a
 * given duration. push_in keeps the original `zoom` form verbatim because it is
 * the one variant proven by real renders.
 *
 * Pans need headroom: at z=1.14 the visible window is iw/zoom wide, so the crop
 * origin can travel 0..(iw-iw/zoom). Panning at z=1.0 would have nowhere to go
 * and would silently render static — the failure this lane must never produce,
 * since Instagram's monetization policy restricts static video.
 */
export type BeatMotion = "push_in" | "punch_in" | "pull_out" | "pan_right" | "pan_left" | "drift_up";

/**
 * Deterministic per-beat rotation. Deterministic, not random: a retry of beat 3
 * must produce the same move, or a resumed job splices two different cameras
 * into one reel. Same reasoning as SWEEP_TONES cycling on beatNumber.
 */
const MOTION_CYCLE: readonly BeatMotion[] = [
  "push_in",
  "pan_right",
  "pull_out",
  "punch_in",
  "pan_left",
  "drift_up",
] as const;

export function motionForBeat(beatNumber: number): BeatMotion {
  return MOTION_CYCLE[Math.abs(beatNumber) % MOTION_CYCLE.length];
}

/** The zoompan body for one move. `frames` is the clip's output frame count. */
function zoompanFor(motion: BeatMotion, frames: number): string {
  const geom = `d=${frames}:s=${FRAME_W}x${FRAME_H}:fps=${FPS}`;
  // Centre the crop window on the axis a move does NOT travel along.
  const cx = `x='(iw-iw/zoom)/2'`;
  const cy = `y='(ih-ih/zoom)/2'`;
  switch (motion) {
    case "punch_in":
      return `zoompan=z='min(zoom+0.0024,1.30)':${geom}`;
    case "pull_out":
      // Starts tight and eases out. Floor at 1.02, never below 1.0 — a zoom < 1
      // would letterbox the frame.
      return `zoompan=z='max(1.20-0.0011*on,1.02)':${geom}`;
    case "pan_right":
      return `zoompan=z=1.14:x='(iw-iw/zoom)*(on/${frames})':${cy}:${geom}`;
    case "pan_left":
      return `zoompan=z=1.14:x='(iw-iw/zoom)*(1-on/${frames})':${cy}:${geom}`;
    case "drift_up":
      return `zoompan=z=1.14:${cx}:y='(ih-ih/zoom)*(1-on/${frames})':${geom}`;
    case "push_in":
    default:
      // Verbatim the original, proven by real renders.
      return `zoompan=z='min(zoom+0.0009,1.12)':${geom}`;
  }
}

/**
 * Sweep geometries for the gradient path, cycled independently of the tone so
 * the pair does not repeat until tone-count x angle-count beats. Previously only
 * the tone changed, so every gradient beat swept the same diagonal.
 */
const SWEEP_ANGLES = [
  { x0: 0, y0: 0, x1: FRAME_W, y1: FRAME_H },
  { x0: FRAME_W, y0: 0, x1: 0, y1: FRAME_H },
  { x0: 0, y0: Math.round(FRAME_H / 2), x1: FRAME_W, y1: Math.round(FRAME_H / 2) },
  { x0: Math.round(FRAME_W / 2), y0: 0, x1: Math.round(FRAME_W / 2), y1: FRAME_H },
] as const;

/** Wall-clock cap for ONE beat render. Well under GEN_CLIP_TIMEOUT_MS (6 min). */
export const TEMPLATE_CLIP_TIMEOUT_MS = 90_000;

export interface BeatClipArgsOpts {
  /** Clip length in seconds. */
  seconds: number;
  /** Cycles the gradient tone so consecutive beats are not identical. */
  beatNumber: number;
  /** Bare image filename inside the working dir; when absent an animated gradient is used. */
  backgroundFile?: string;
  /**
   * Bare VIDEO filename inside the working dir. Takes precedence over
   * `backgroundFile` — real footage beats a camera move over a still.
   *
   * Deliberately NOT given a zoompan: the footage already carries motion, and
   * stacking a synthetic push on top of real movement reads as amateur rather
   * than produced. What it does need and a still does not: looping (source may
   * be shorter than the beat) and fps normalisation (source may be 24/25/60).
   */
  backgroundVideoFile?: string;
  /** Bare output filename inside the working dir. */
  outFile: string;
  /**
   * Camera move for a still. Omitted = the deterministic per-beat rotation, so
   * existing callers get variety with no change. An explicit value lets a
   * creative director match the move to the beat's energy.
   */
  motion?: BeatMotion;
}

/**
 * PURE ffmpeg argv for one beat clip — no I/O, no spawn, so the filtergraph is
 * unit-testable. Same discipline as reelAssembly.buildFfmpegArgs, which exists
 * precisely because filtergraph bugs are otherwise only findable by rendering.
 *
 * NO SPACES anywhere in the filtergraph. ffmpeg is spawned with shell:true on
 * Windows (the repo-wide convention), which CONCATENATES argv rather than
 * passing it — so a space inside the -vf value is re-split by the shell and
 * ffmpeg reads a fragment like `-` as the output filename ("Unable to choose an
 * output format for 'pipe:'"). Found by an actual render; the args array looks
 * correct in a unit test either way.
 *
 * Every path is a BARE filename: the caller runs ffmpeg with cwd = the working
 * directory, so a `C:\...` path can never put a drive-letter colon inside a
 * colon-delimited filter option.
 */
export function buildBeatClipArgs(o: BeatClipArgsOpts): string[] {
  const seconds = Math.max(1, Number(o.seconds.toFixed(2)));
  const frames = Math.round(seconds * FPS);
  const args: string[] = ["-y", "-v", "error"];
  const filters: string[] = [];

  if (o.backgroundVideoFile) {
    // Real footage. `-stream_loop -1` MUST precede its `-i` (it is an input
    // option), and the later `-t` truncates the infinitely-looped stream back to
    // the beat length — so a 2s clip fills a 6s beat instead of freezing on its
    // last frame or ending the clip early.
    args.push("-stream_loop", "-1", "-t", String(seconds), "-i", o.backgroundVideoFile);
    filters.push(
      `scale=${FRAME_W}:${FRAME_H}:force_original_aspect_ratio=increase`,
      `crop=${FRAME_W}:${FRAME_H}`,
      // Source fps is unknown (24/25/30/60 all occur). Without this the output
      // -r just drops or duplicates frames unevenly and the motion judders.
      `fps=${FPS}`,
      "format=yuv420p",
    );
  } else if (o.backgroundFile) {
    // Still image → fill the vertical frame, then a slow push-in. zoompan runs
    // on the SCALED frame, so d= is in output frames and s= must restate the
    // frame size or zoompan silently falls back to its 1x1 default.
    args.push("-loop", "1", "-t", String(seconds), "-i", o.backgroundFile);
    filters.push(
      `scale=${FRAME_W}:${FRAME_H}:force_original_aspect_ratio=increase`,
      `crop=${FRAME_W}:${FRAME_H}`,
      zoompanFor(o.motion ?? motionForBeat(o.beatNumber), frames),
    );
  } else {
    // No still: an animated gradient. `gradients` is a source filter, so it is
    // its own input rather than a filter over a colour input.
    const tone = SWEEP_TONES[Math.abs(o.beatNumber) % SWEEP_TONES.length];
    // Tone and angle cycle on DIFFERENT moduli (4 vs 4 but offset by the +1), so
    // the pair varies rather than locking to one tone-angle combination.
    const angle = SWEEP_ANGLES[Math.abs(o.beatNumber + 1) % SWEEP_ANGLES.length];
    // Speed varies slightly per beat too — an identical sweep rate across beats
    // is the same repetition problem one layer down.
    const speed = (0.06 + (Math.abs(o.beatNumber) % 3) * 0.02).toFixed(2);
    args.push(
      "-f",
      "lavfi",
      "-i",
      `gradients=s=${FRAME_W}x${FRAME_H}:c0=${BASE_DARK}:c1=${tone}:x0=${angle.x0}:y0=${angle.y0}:x1=${angle.x1}:y1=${angle.y1}:d=${seconds}:r=${FPS}:speed=${speed}`,
    );
    filters.push("format=yuv420p");
  }

  args.push(
    "-vf",
    filters.join(","),
    "-t",
    String(seconds),
    "-r",
    String(FPS),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    // Silent by design — assembly lays the voiceover over the stitched clips.
    "-an",
    o.outFile,
  );

  return args;
}

function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

/**
 * Render ONE beat clip locally and re-host it.
 *
 * Returns a public http(s) URL. That is load-bearing twice over: the pipeline's
 * resume-skip tests `clipUrls[i].startsWith("http")`, so a local path would be
 * re-rendered on every retry forever; and the publish gate rejects anything that
 * is not a permanent public URL.
 */
export async function generateTemplateStockClip(input: {
  beatNumber: number;
  seconds?: number;
  /** Optional still to move the camera over (brand asset, shop photo, licensed stock). */
  backgroundImageUrl?: string;
  /**
   * Optional real footage. Wins over `backgroundImageUrl` when both are given —
   * footage of the actual shop is the one asset class that clears
   * HARD_REJECT_RULES[0] by construction, because no other shop can run it.
   */
  backgroundVideoUrl?: string;
  /** Override the per-beat camera move. Ignored when footage is supplied. */
  motion?: BeatMotion;
}): Promise<string> {
  const fs = await import("fs/promises");
  const os = await import("os");
  const path = await import("path");

  const seconds = Math.min(input.seconds ?? MAX_CLIP_SECONDS, MAX_CLIP_SECONDS);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `tmplstock-${input.beatNumber}-`));
  try {
    /** Fetch one asset into the working dir. Returns undefined on any failure —
     *  a missing background degrades to the next tier, never fails the beat. */
    const fetchAsset = async (url: string, name: string, what: string): Promise<string | undefined> => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) return undefined;
        await fs.writeFile(path.join(workDir, name), Buffer.from(await res.arrayBuffer()));
        return name;
      } catch (e) {
        log.warn(`template_stock ${what} fetch failed, falling back`, {
          beat: input.beatNumber,
          err: e instanceof Error ? e.message : String(e),
        });
        return undefined;
      }
    };

    // Asset tiers, best first: real footage > still > generated gradient. Each
    // tier's failure falls through to the next rather than failing the beat.
    let backgroundVideoFile: string | undefined;
    if (input.backgroundVideoUrl?.startsWith("http")) {
      backgroundVideoFile = await fetchAsset(input.backgroundVideoUrl, "bg.mp4", "footage");
    }
    let backgroundFile: string | undefined;
    if (!backgroundVideoFile && input.backgroundImageUrl?.startsWith("http")) {
      backgroundFile = await fetchAsset(input.backgroundImageUrl, "bg.jpg", "background");
    }

    const outFile = `beat-${input.beatNumber}.mp4`;
    const motion = input.motion ?? motionForBeat(input.beatNumber);
    await runFfmpeg(
      buildBeatClipArgs({
        seconds,
        beatNumber: input.beatNumber,
        backgroundVideoFile,
        backgroundFile,
        outFile,
        motion,
      }),
      workDir,
    );

    const mp4 = await fs.readFile(path.join(workDir, outFile));
    if (mp4.length === 0) throw new Error("template_stock: ffmpeg produced an empty file");

    const { storagePut } = await import("../storage");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const { url } = await storagePut(
      `reels/template-stock/${stamp}-beat-${input.beatNumber}.mp4`,
      mp4,
      "video/mp4",
    );
    log.info("template_stock clip rendered", {
      beat: input.beatNumber,
      // Which tier actually rendered — a footage beat and a gradient beat are
      // very different creative outcomes and the log has to distinguish them.
      source: backgroundVideoFile ? "footage" : backgroundFile ? "still" : "gradient",
      motion: backgroundVideoFile ? "n/a-footage-carries-its-own" : motion,
      bytes: mp4.length,
      url,
    });
    return url;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function runFfmpeg(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, {
      cwd,
      shell: process.platform === "win32" && !process.env.FFMPEG_PATH,
    });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`template_stock: ffmpeg timed out after ${TEMPLATE_CLIP_TIMEOUT_MS / 1000}s`));
    }, TEMPLATE_CLIP_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`template_stock: ffmpeg failed to start (${e.message})`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`template_stock: ffmpeg exited ${code}${stderr ? ` — ${stderr.slice(-500)}` : ""}`));
    });
  });
}
