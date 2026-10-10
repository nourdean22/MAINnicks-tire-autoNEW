/**
 * externalMasterFinish — the finishing pass a Higgsfield-UI master skipped
 * (2026-10-10). The three pilot Reels were exported from the Higgsfield web app
 * and published as-is, so they carried Seedance's ambient track and nothing
 * else: no music bed, no loudness normalisation, no film grain, untagged
 * colour. Every pipeline reel gets those from reelAssembly; an external master
 * never reached it. This module applies the SAME finish to a finished mp4
 * without re-cutting it: duration, frame count and picture are preserved, so
 * approveDraft's duration check (beats + 3) still holds on the finished file.
 *
 * Audio: the master's own track stays the lead (Seedance SFX and ambience are
 * the only sound the picture has), a music bed loops underneath at a fixed
 * level, and the mix is normalised to the delivery target (-14 LUFS, -1.5 dBTP)
 * that audioQa measures. A master with no audio stream gets the bed alone.
 *
 * Pure arg builder + a thin runner, same split as reelAssembly, so the graph is
 * unit-tested without ffmpeg and the runner is the only side effect.
 */
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createLogger } from "../lib/logger";
import { opticalFinishFilter, pickMusicBed, type ReelAssemblyBrief } from "./reelAssembly";

const log = createLogger("services:external-master-finish");

/** Music under native SFX/ambience, not under a voiceover: louder than the VO bed (0.6 ducked) would be wrong,
 *  because nothing ducks it; 0.30 sits under the picture's own sound without burying it. */
export const FINISH_MUSIC_VOLUME = 0.3;

export interface FinishArgsInput {
  inputPath: string;
  /** Looping music bed; null = no music (the master's audio is only normalised). */
  musicPath: string | null;
  /** Whether the master has an audio stream (ffprobe). Without one the bed is the whole track. */
  hasAudio: boolean;
  /** Master duration in seconds; the output is cut to exactly this. */
  durationSec: number;
  outPath: string;
  /** Optical finish filter (grain + vignette, or "null"); injected so the builder is pure. */
  optical?: string;
}

/** Pure: the ffmpeg argv for one finishing pass. */
export function buildFinishArgs(o: FinishArgsInput): string[] {
  const dur = Math.max(1, Number(o.durationSec.toFixed(3)));
  const optical = o.optical ?? opticalFinishFilter();
  const inputs = ["-i", o.inputPath];
  if (o.musicPath) inputs.push("-stream_loop", "-1", "-i", o.musicPath);
  const fc: string[] = [
    // Picture: untouched geometry (the master is already 1080x1920); grain + vignette when the flag is on.
    `[0:v]fps=30,setsar=1,format=yuv420p,${optical}[vout]`,
  ];
  const norm = `loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000`;
  if (o.musicPath && o.hasAudio) {
    fc.push(
      `[0:a]aresample=48000[nat]`,
      `[1:a]aresample=48000,volume=${FINISH_MUSIC_VOLUME},atrim=0:${dur}[mus]`,
      // duration=first: the master's track defines the length; the looped bed can never extend it.
      `[nat][mus]amix=inputs=2:duration=first:normalize=0[am]`,
      `[am]atrim=0:${dur},asetpts=PTS-STARTPTS,apad=whole_dur=${dur},${norm}[aout]`,
    );
  } else if (o.musicPath) {
    fc.push(`[1:a]aresample=48000,volume=${FINISH_MUSIC_VOLUME},atrim=0:${dur},asetpts=PTS-STARTPTS,${norm}[aout]`);
  } else if (o.hasAudio) {
    fc.push(`[0:a]aresample=48000,atrim=0:${dur},asetpts=PTS-STARTPTS,apad=whole_dur=${dur},${norm}[aout]`);
  }
  const haveAudioOut = Boolean(o.musicPath || o.hasAudio);
  return [
    "-y",
    ...inputs,
    "-filter_complex", fc.join(";"),
    "-map", "[vout]",
    ...(haveAudioOut ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"] : ["-an"]),
    "-t", String(dur),
    "-r", "30",
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
    // Same Rec.709 declaration reelAssembly writes, for the same reason: an untagged file is decoded differently
    // by Instagram's transcoder, Safari and Chrome.
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
    "-movflags", "+faststart",
    o.outPath,
  ];
}

export interface FinishResult {
  outPath: string;
  bytes: number;
  sha256: string;
  durationSec: number;
  usedMusic: string | null;
  grain: boolean;
}

function ffmpegBin(): string { return process.env.FFMPEG_PATH || "ffmpeg"; }
function ffprobeBin(): string { return process.env.FFPROBE_PATH || "ffprobe"; }

async function run(bin: string, args: string[], label: string): Promise<string> {
  const { spawn } = await import("child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" && !process.env.FFMPEG_PATH });
    let out = ""; let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${label} exited ${code}: ${err.slice(-600)}`))));
  });
}

export async function probeMaster(filePath: string): Promise<{ durationSec: number; hasAudio: boolean; width: number; height: number }> {
  const out = await run(ffprobeBin(), ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath], "ffprobe");
  const j = JSON.parse(out) as { streams?: Array<Record<string, unknown>>; format?: { duration?: string } };
  const v = (j.streams ?? []).find((s) => s.codec_type === "video");
  if (!v) throw new Error("master has no video stream");
  return {
    durationSec: Number(j.format?.duration ?? 0),
    hasAudio: (j.streams ?? []).some((s) => s.codec_type === "audio"),
    width: Number(v.width), height: Number(v.height),
  };
}

/**
 * Finish a local master into a new local file. The caller owns upload and
 * registration (the pilot publisher stores it next to the master and records
 * both hashes). Never mutates the input.
 */
export async function finishExternalMaster(inputPath: string, opts: { brief?: Pick<ReelAssemblyBrief, "voiceoverScript"> & { archetype?: string; id?: string }; musicPath?: string | null; outPath?: string } = {}): Promise<FinishResult> {
  const meta = await probeMaster(inputPath);
  if (meta.width !== 1080 || meta.height !== 1920) throw new Error(`master is ${meta.width}x${meta.height}; the finish pass expects a 1080x1920 master and never rescales one`);
  if (!(meta.durationSec > 0)) throw new Error("master has no duration");
  const musicPath = opts.musicPath === undefined ? pickMusicBed((opts.brief ?? { voiceoverScript: "" }) as ReelAssemblyBrief) : opts.musicPath;
  const outPath = opts.outPath ?? path.join(os.tmpdir(), `finish-${Date.now()}-${Math.round(Math.random() * 1e9)}.mp4`);
  const optical = opticalFinishFilter();
  const args = buildFinishArgs({ inputPath, musicPath, hasAudio: meta.hasAudio, durationSec: meta.durationSec, outPath, optical });
  log.info("finishing external master", { inputPath, durationSec: meta.durationSec, hasAudio: meta.hasAudio, music: musicPath ? path.basename(musicPath) : null, grain: optical !== "null" });
  await run(ffmpegBin(), args, "ffmpeg finish");
  const bytes = fs.readFileSync(outPath);
  const after = await probeMaster(outPath);
  if (Math.abs(after.durationSec - meta.durationSec) > 0.25) {
    throw new Error(`finish changed the duration (${meta.durationSec.toFixed(2)} s -> ${after.durationSec.toFixed(2)} s); approveDraft would refuse it`);
  }
  if (!after.hasAudio) throw new Error("finished master has no audio stream — the quality gate requires voice or music");
  return { outPath, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), durationSec: after.durationSec, usedMusic: musicPath ? path.basename(musicPath) : null, grain: optical !== "null" };
}
