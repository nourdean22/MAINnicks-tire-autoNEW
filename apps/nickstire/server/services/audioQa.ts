/**
 * Audio QA (directive Part XIII §58) — the deterministic half of the Audio
 * Director. The baseline scored audio 2/10 and shipped a reel 68% dead-air +
 * mono 55kbps; the dead-air GATE (evaluateAudioIntegrity) was the first
 * reactive fix. This module is the standing measurement: loudness, true peak,
 * clipping, silence, channels, sample rate — "a visually strong reel with
 * poor audio must not pass."
 *
 * Deterministic only — model-based voice-naturalness scoring is the OTHER half
 * (§53, requires a listening pass) and is honestly NOT done here. This proves
 * what ffmpeg can prove; naturalness stays a named gap.
 */
import { spawn } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { DB } from "../db";
import { createLogger } from "../lib/logger";
const log = createLogger("services:audio-qa");

export interface StoredAudioQa extends AudioQaResult {
  qaState: "completed";
  evaluatedAt: string;
  masterSha256: string;
  measuredOn: string;
}

/** 300 MB: a 90 s 1080x1920 master is 20-60 MB; anything larger is not a reel master. */
const MASTER_MAX_BYTES = 300 * 1024 * 1024;

/**
 * Measure the audio of a job's CURRENT master (the exact bytes at mp4Url) and
 * persist the verdict to payload.audioQa with a compare-and-set (2026-10-10).
 *
 * Why this exists: audio QA ran only inside reelAssembly, so a master that
 * arrived any other way (a Higgsfield-UI export, an operator ingest) had no
 * verdict, the publish gate read 'unavailable' forever, and the daily drain
 * selected that one job on every pulse and held it — job 2070001 jammed the
 * lane for a day. The gate now calls this when audio evidence is missing, so
 * "never evaluated" becomes "evaluated" on first contact. Returns null on any
 * failure (no master, fetch refused, ffmpeg error, lost CAS race); the caller
 * stays fail-closed on null.
 */
export async function measureJobAudioQa(database: DB, jobId: number): Promise<StoredAudioQa | null> {
  const { reelJobs } = await import("../../drizzle/schema");
  const { and, eq } = await import("drizzle-orm");
  const readJob = async () => (await database.select({ mp4Url: reelJobs.mp4Url, payload: reelJobs.payload }).from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1))[0];
  let workDir: string | null = null;
  try {
    const job = await readJob();
    if (!job?.mp4Url || !/^https?:\/\//.test(job.mp4Url)) {
      log.warn("audio QA on demand: job has no http master", { jobId });
      return null;
    }
    const { fetchPublicBounded } = await import("../lib/publicFetch");
    const master = await fetchPublicBounded(job.mp4Url, { maxBytes: MASTER_MAX_BYTES, timeoutMs: 120_000, maxRedirects: 3, label: "reel master for audio QA" });
    const masterSha256 = createHash("sha256").update(master).digest("hex");
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), `audioqa-${jobId}-`));
    const file = path.join(workDir, "master.mp4");
    fs.writeFileSync(file, master);
    const result = await runAudioQa(file);
    const verdict: StoredAudioQa = { ...result, qaState: "completed", evaluatedAt: new Date().toISOString(), masterSha256, measuredOn: "publish gate on demand, the exact bytes at mp4Url" };
    for (let attempt = 0; attempt < 3; attempt++) {
      const fresh = await readJob();
      if (!fresh) return null;
      if (fresh.mp4Url !== job.mp4Url) {
        log.warn("audio QA on demand: master URL changed while measuring — not attaching a verdict for other bytes", { jobId });
        return null;
      }
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(fresh.payload ?? "{}"); } catch { return null; }
      payload.audioQa = verdict;
      const r = await database.update(reelJobs).set({ payload: JSON.stringify(payload), updatedAt: new Date() }).where(and(eq(reelJobs.id, jobId), eq(reelJobs.payload, fresh.payload ?? "")));
      const affected = Number((r as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? (r as unknown as { affectedRows?: number }).affectedRows ?? 1);
      if (affected > 0) {
        log.info("audio QA on demand: verdict attached", { jobId, decision: verdict.decision, integratedLufs: verdict.integratedLufs, masterSha256: masterSha256.slice(0, 12) });
        return verdict;
      }
    }
    log.warn("audio QA on demand: lost the compare-and-set three times", { jobId });
    return null;
  } catch (err) {
    log.warn("audio QA on demand failed — gate stays unavailable", { jobId, err: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return null;
  } finally {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** Platform audio delivery target (IG/Reels-aligned). Verify date carried so a
 *  spec change is visible. */
export const AUDIO_DELIVERY = {
  platform: "instagram_reels",
  integratedLufsMin: -16,
  integratedLufsMax: -12,
  truePeakMaxDb: -1,
  minChannels: 2,
  minSampleRate: 44100,
  verifiedAt: "2026-07-17",
} as const;

export interface AudioQaResult {
  hasAudio: boolean;
  integratedLufs: number | null;
  truePeakDb: number | null;
  channels: number | null;
  sampleRate: number | null;
  clipping: boolean;
  findings: string[];
  decision: "approve" | "repair";
}

function ffmpegStderr(args: string[], timeoutMs = 90_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = process.env.FFMPEG_PATH || "ffmpeg";
    const child = spawn(bin, ["-hide_banner", ...args], { shell: process.platform === "win32" && !process.env.FFMPEG_PATH });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += String(d); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("ffmpeg timed out")); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => { clearTimeout(timer); resolve(stderr); });
  });
}

/** Parse loudnorm's JSON block (printed to stderr) for integrated LUFS + true peak. */
export function parseLoudnorm(stderr: string): { integratedLufs: number | null; truePeakDb: number | null } {
  const iMatch = stderr.match(/"input_i"\s*:\s*"(-?[\d.]+)"/);
  const tpMatch = stderr.match(/"input_tp"\s*:\s*"(-?[\d.]+)"/);
  return {
    integratedLufs: iMatch ? Number(iMatch[1]) : null,
    truePeakDb: tpMatch ? Number(tpMatch[1]) : null,
  };
}

/** astats reports per-channel peak level in dB; a level at/above 0 dBFS clips. */
export function detectClipping(astatsStderr: string): boolean {
  for (const m of astatsStderr.matchAll(/Peak level dB:\s*(-?[\d.inf]+)/gi)) {
    const v = m[1].toLowerCase();
    if (v === "inf" || v === "0" || Number(v) >= 0) return true;
  }
  return false;
}

/** Compose the verdict from measured facts (pure — unit-tested). */
export function composeAudioVerdict(input: {
  hasAudio: boolean;
  integratedLufs: number | null;
  truePeakDb: number | null;
  channels: number | null;
  sampleRate: number | null;
  clipping: boolean;
}): AudioQaResult {
  const findings: string[] = [];
  if (!input.hasAudio) {
    findings.push("no audio stream — a reel must carry voice or music");
    return { ...input, findings, decision: "repair" };
  }
  if (input.integratedLufs !== null && (input.integratedLufs < AUDIO_DELIVERY.integratedLufsMin || input.integratedLufs > AUDIO_DELIVERY.integratedLufsMax)) {
    findings.push(`loudness ${input.integratedLufs} LUFS outside ${AUDIO_DELIVERY.integratedLufsMin}..${AUDIO_DELIVERY.integratedLufsMax}`);
  }
  if (input.truePeakDb !== null && input.truePeakDb > AUDIO_DELIVERY.truePeakMaxDb) {
    findings.push(`true peak ${input.truePeakDb} dBTP exceeds ${AUDIO_DELIVERY.truePeakMaxDb}`);
  }
  if (input.clipping) findings.push("clipping detected (peak at or above 0 dBFS)");
  if (input.channels !== null && input.channels < AUDIO_DELIVERY.minChannels) {
    findings.push(`mono audio (${input.channels}ch) — platform target is stereo`);
  }
  if (input.sampleRate !== null && input.sampleRate < AUDIO_DELIVERY.minSampleRate) {
    findings.push(`sample rate ${input.sampleRate}Hz below ${AUDIO_DELIVERY.minSampleRate}Hz`);
  }
  // Loudness/peak/clip are hard; channels/samplerate are warnings that don't
  // alone force a repair (a stereo-encoded reel is the norm now).
  // "no audio stream" — anchored: an unanchored "no audio" also matches inside
  // "moNO AUDIO (1ch)" (the mono warning), which wrongly forced a repair.
  const hard = findings.some((f) => /loudness|true peak|clipping|no audio stream/.test(f));
  return { ...input, findings, decision: hard ? "repair" : "approve" };
}

/** Measure a rendered file's audio end-to-end. */
export async function runAudioQa(mp4Path: string): Promise<AudioQaResult> {
  const probe = await ffmpegStderr(["-i", mp4Path, "-f", "null", "-"]).catch(() => "");
  const audioLine = probe.match(/Audio:\s*[^,]+,\s*(\d+)\s*Hz,\s*(mono|stereo|(\d+)\s*channels)/i);
  const hasAudio = /Audio:/.test(probe);
  const sampleRate = audioLine ? Number(audioLine[1]) : null;
  const channels = audioLine ? (/mono/i.test(audioLine[2]) ? 1 : /stereo/i.test(audioLine[2]) ? 2 : Number(audioLine[3] ?? 2)) : null;

  let integratedLufs: number | null = null;
  let truePeakDb: number | null = null;
  let clipping = false;
  if (hasAudio) {
    const loud = await ffmpegStderr(["-i", mp4Path, "-af", "loudnorm=print_format=json", "-f", "null", "-"]);
    ({ integratedLufs, truePeakDb } = parseLoudnorm(loud));
    const astats = await ffmpegStderr(["-i", mp4Path, "-af", "astats=metadata=1", "-f", "null", "-"]);
    clipping = detectClipping(astats);
  }

  const result = composeAudioVerdict({ hasAudio, integratedLufs, truePeakDb, channels, sampleRate, clipping });
  log.info("audio QA complete", { path: mp4Path, decision: result.decision, findings: result.findings.length });
  return result;
}


// ─── The reel's audio mix and its two-pass loudnorm (deep scout 2026-10-17 #10) ───
// Lives here, beside the post-render loudness measure, and reelAssembly imports it:
// the render graph and the first (measure) pass are built from the SAME mix chain.

/** The single-pass target. Also the fallback whenever the measure pass gives nothing usable. */
const LOUDNORM_SINGLE_PASS = "loudnorm=I=-14:TP=-1.5:LRA=11";

/** The five values a loudnorm first pass prints that its second pass consumes, kept as ffmpeg printed them. */
export interface LoudnormMeasured {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/**
 * Parse the LAST loudnorm JSON block in ffmpeg's stderr. Null (single pass) when it
 * is missing, malformed, or any value is non-finite (a silent track measures -inf).
 */
function parseLoudnormMeasure(stderr: string): LoudnormMeasured | null {
  const blocks = stderr.match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!blocks) return null;
  try {
    const j = JSON.parse(blocks[blocks.length - 1]) as Record<string, unknown>;
    const keys = ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"] as const;
    if (!keys.every((k) => typeof j[k] === "string" && Number.isFinite(Number(j[k])))) return null;
    return Object.fromEntries(keys.map((k) => [k, j[k]])) as unknown as LoudnormMeasured;
  } catch {
    return null;
  }
}

/** Second pass with the measured values (one linear gain) or, without them, today's single pass. Pure. */
export function loudnormFilter(m: LoudnormMeasured | null | undefined): string {
  if (!m) return LOUDNORM_SINGLE_PASS;
  return `${LOUDNORM_SINGLE_PASS}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
}

/**
 * The audio half of the render graph, ending in [aout] after `norm` (the loudnorm step).
 * Shared by the render and by the loudnorm measure pass so both see the same mix.
 * Empty when there is no VO and no music.
 */
export function audioMixFilters(voIdx: number | null, musIdx: number | null, videoTotal: number, norm: string): string[] {
  if (voIdx !== null && musIdx !== null) {
    // Phase 4.2: duck the music DYNAMICALLY under the VO via sidechaincompress
    // (keyed off the VO) instead of a static volume — music breathes back in the
    // gaps. Both sources resampled to a common rate first (sidechaincompress
    // requires it).
    //
    // TWO length bugs lived here and produced the published dead-air defect
    // (reel-30008: silent from VO-end 7.1s to 22.0s — measured, see
    // docs/execution/creative-quality/QUALITY-BASELINE.json):
    //  1. sidechaincompress ENDS ITS OUTPUT when the KEY input ends. A 7s VO
    //     key truncated the ducked music to 7s, amix had nothing longer, and
    //     apad filled the rest with digital silence — so "music carries
    //     through" was never true. The key is now silence-padded to the full
    //     timeline: silence key = zero compression = music actually breathes
    //     back in after the VO.
    //  2. a bed shorter than the reel died at bed-end the same way. Beds are
    //     now looped (aloop) before trimming, so any bed covers any legal
    //     reel length (duration gate allows up to 90s).
    return [
      `[${voIdx}:a]aresample=48000,volume=1.15,asplit=2[vo_mix][vo_key]`,
      `[vo_key]apad=whole_dur=${videoTotal}[vo_key_p]`,
      `[${musIdx}:a]aloop=loop=-1:size=4000000,aresample=48000,volume=0.6,atrim=0:${videoTotal}[mus_raw]`,
      `[mus_raw][vo_key_p]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[mus_duck]`,
      `[vo_mix][mus_duck]amix=inputs=2:duration=longest:normalize=0[am]`,
      `[am]atrim=0:${videoTotal},asetpts=PTS-STARTPTS,apad=whole_dur=${videoTotal},${norm}[aout]`,
    ];
  }
  if (voIdx !== null) {
    // aresample FIRST so loudnorm computes the apad/duration on a known 48k rate.
    // NOTE: this branch pads everything after the VO with silence — acceptable
    // only for VO that spans (most of) the video. The dead-air render gate in
    // assembleReel refuses the result otherwise.
    return [`[${voIdx}:a]aresample=48000,volume=1.15,atrim=0:${videoTotal},asetpts=PTS-STARTPTS,apad=whole_dur=${videoTotal},${norm}[aout]`];
  }
  if (musIdx !== null) {
    // Loop the bed here too — a 60s bed under a 90s reel must not die at 60s.
    return [`[${musIdx}:a]aloop=loop=-1:size=4000000,aresample=48000,volume=0.5,atrim=0:${videoTotal},asetpts=PTS-STARTPTS,apad=whole_dur=${videoTotal},${norm}[aout]`];
  }
  return [];
}

/**
 * Loudnorm FIRST pass (deep scout 2026-10-17 #10): the render's own audio mix, re-indexed
 * to audio-only inputs, measured with print_format=json into a null output. Null when the
 * reel has no audio. Pure.
 */
function buildLoudnormMeasureArgs(opts: LoudnormMeasureInput): string[] | null {
  const inputs: string[] = [];
  if (opts.voPath) inputs.push("-i", opts.voPath);
  if (opts.musicPath) inputs.push("-i", opts.musicPath);
  const fc = audioMixFilters(opts.voPath ? 0 : null, opts.musicPath ? (opts.voPath ? 1 : 0) : null, opts.videoTotal, `${LOUDNORM_SINGLE_PASS}:print_format=json`);
  if (!fc.length) return null;
  return [...inputs, "-filter_complex", fc.join(";"), "-map", "[aout]", "-f", "null", "-"];
}

/**
 * Run the first pass and parse it. Any failure (ffmpeg error, timeout, no or bad JSON)
 * is null, so the render falls back to today's single-pass filter; it never fails the job.
 */
export async function measureMixLoudness(
  opts: LoudnormMeasureInput,
  run: (args: string[], timeoutMs?: number, cwd?: string) => Promise<string>,
  cwd?: string,
): Promise<LoudnormMeasured | null> {
  const args = buildLoudnormMeasureArgs(opts);
  if (!args) return null;
  try {
    const m = parseLoudnormMeasure(await run(args, 2 * 60 * 1000, cwd));
    if (!m) log.info("loudnorm measure pass gave no usable values - single-pass loudnorm");
    return m;
  } catch (e) {
    log.info("loudnorm measure pass failed - single-pass loudnorm", { e: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    return null;
  }
}

/** What the measure pass needs: the two audio sources and the rendered length (beats + SAVE freeze). */
export interface LoudnormMeasureInput {
  voPath?: string | null;
  musicPath?: string | null;
  videoTotal: number;
}
