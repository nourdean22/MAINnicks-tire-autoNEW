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
 * restricts static videos and text montages, so every clip carries real motion —
 * a slow push-in on a supplied still, or an animated gradient sweep otherwise —
 * and the gradient tone cycles per beat so a multi-beat reel is not N identical
 * backdrops.
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

/** Wall-clock cap for ONE beat render. Well under GEN_CLIP_TIMEOUT_MS (6 min). */
export const TEMPLATE_CLIP_TIMEOUT_MS = 90_000;

export interface BeatClipArgsOpts {
  /** Clip length in seconds. */
  seconds: number;
  /** Cycles the gradient tone so consecutive beats are not identical. */
  beatNumber: number;
  /** Bare image filename inside the working dir; when absent an animated gradient is used. */
  backgroundFile?: string;
  /** Bare output filename inside the working dir. */
  outFile: string;
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

  if (o.backgroundFile) {
    // Still image → fill the vertical frame, then a slow push-in. zoompan runs
    // on the SCALED frame, so d= is in output frames and s= must restate the
    // frame size or zoompan silently falls back to its 1x1 default.
    args.push("-loop", "1", "-t", String(seconds), "-i", o.backgroundFile);
    filters.push(
      `scale=${FRAME_W}:${FRAME_H}:force_original_aspect_ratio=increase`,
      `crop=${FRAME_W}:${FRAME_H}`,
      `zoompan=z='min(zoom+0.0009,1.12)':d=${frames}:s=${FRAME_W}x${FRAME_H}:fps=${FPS}`,
    );
  } else {
    // No still: an animated gradient. `gradients` is a source filter, so it is
    // its own input rather than a filter over a colour input.
    const tone = SWEEP_TONES[Math.abs(o.beatNumber) % SWEEP_TONES.length];
    args.push(
      "-f",
      "lavfi",
      "-i",
      `gradients=s=${FRAME_W}x${FRAME_H}:c0=${BASE_DARK}:c1=${tone}:x0=0:y0=0:x1=${FRAME_W}:y1=${FRAME_H}:d=${seconds}:r=${FPS}:speed=0.08`,
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
  /** Optional still to push in on (brand asset, shop photo, licensed stock). */
  backgroundImageUrl?: string;
}): Promise<string> {
  const fs = await import("fs/promises");
  const os = await import("os");
  const path = await import("path");

  const seconds = Math.min(input.seconds ?? MAX_CLIP_SECONDS, MAX_CLIP_SECONDS);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `tmplstock-${input.beatNumber}-`));
  try {
    let backgroundFile: string | undefined;
    if (input.backgroundImageUrl?.startsWith("http")) {
      try {
        const res = await fetch(input.backgroundImageUrl, { signal: AbortSignal.timeout(20_000) });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          backgroundFile = "bg.jpg";
          await fs.writeFile(path.join(workDir, backgroundFile), buf);
        }
      } catch (e) {
        // A missing still is not a failure — the gradient path is the fallback,
        // and it still carries motion.
        log.warn("template_stock background fetch failed, using gradient", {
          beat: input.beatNumber,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const outFile = `beat-${input.beatNumber}.mp4`;
    await runFfmpeg(
      buildBeatClipArgs({ seconds, beatNumber: input.beatNumber, backgroundFile, outFile }),
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
    log.info("template_stock clip rendered", { beat: input.beatNumber, bytes: mp4.length, url });
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
