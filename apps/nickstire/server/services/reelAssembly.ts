/**
 * Faceless Reel assembly — PURE ffmpeg/segment logic (no I/O).
 *
 * Ported from the proven scratch/assemble-reel.ts recipe that produced the 3
 * reels posted live to @nicks_tire_euclid. Keeping the ffmpeg-arg construction
 * pure makes it unit-testable without spawning ffmpeg; the I/O orchestration
 * (clip download, VO/music gen, ffmpeg spawn, storagePut) is the orchestration
 * section at the bottom of this file.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { createLogger } from "../lib/logger";

const log = createLogger("services:reel-assembly");

export interface AssemblyBeat {
  beatNumber: number;
  startSecond?: number;
  endSecond?: number;
  onScreenText?: string;
  visual?: string;
}

export interface ReelAssemblyBrief {
  id?: string;
  selectedCaption?: string;
  hashtags?: string[];
  voiceoverScript?: string;
  storyboardBeats: AssemblyBeat[];
}

export interface ReelSegment {
  beatNumber: number;
  dur: number;
  caption: string;
  fontSize: number;
}

/** seedance clips render at ~4s — never trim a beat longer than its source clip. */
export const MAX_CLIP_SECONDS = 4;
const MIN_BEAT_SECONDS = 0.8;
const DEFAULT_BEAT_SECONDS = 3;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Drop the characters that break or garble an ffmpeg drawtext value (the caption
 * is embedded as `text='<caption>'` and re-parsed by drawtext's own expander):
 *   '  ends the single-quoted value
 *   \  filtergraph escape char — a trailing one eats the closing quote and
 *      swallows the rest of the graph
 *   %  triggers drawtext %{...} expansion / renders as a stray % (verified:
 *      escaping as `\%` does NOT work — the filtergraph layer eats the backslash
 *      first — so these are stripped, not escaped)
 * Then flatten newlines, collapse whitespace, and uppercase for the bold
 * muted-first caption look used in the shipped reels.
 */
export function sanitizeCaption(raw: string): string {
  return (raw ?? "")
    .replace(/[\\'%]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Bigger text for short punchy captions, smaller for long ones (proven 44-64 band). */
export function captionFontSize(caption: string): number {
  const len = caption.length;
  if (len <= 14) return 64;
  if (len <= 20) return 56;
  if (len <= 28) return 50;
  return 44;
}

/** One segment per storyboard beat; duration from the beat's own start/end timing. */
export function briefToSegments(brief: ReelAssemblyBrief): ReelSegment[] {
  const beats = [...(brief.storyboardBeats ?? [])].sort((a, b) => a.beatNumber - b.beatNumber);
  if (!beats.length) throw new Error("reel brief has no storyboardBeats — nothing to assemble");
  return beats.map((b) => {
    const raw = Number(b.endSecond) - Number(b.startSecond);
    const dur = clamp(
      Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BEAT_SECONDS,
      MIN_BEAT_SECONDS,
      MAX_CLIP_SECONDS,
    );
    const caption = sanitizeCaption(b.onScreenText ?? "");
    return { beatNumber: b.beatNumber, dur: Number(dur.toFixed(2)), caption, fontSize: captionFontSize(caption) };
  });
}

export function segmentsTotalSeconds(segs: ReelSegment[]): number {
  return Number(segs.reduce((a, s) => a + s.dur, 0).toFixed(2));
}

export interface FfmpegBuildOpts {
  segs: ReelSegment[];
  clipPaths: string[];
  voPath: string | null;
  musicPath: string | null;
  fontPath: string;
  outPath: string;
}

/**
 * Build the ffmpeg arg vector for a vertical 1080x1920 captioned reel.
 * Mirrors scratch/assemble-reel.ts: per-beat trim->scale->crop->concat, captions
 * burned on HALF-OPEN [start,end) intervals (inclusive between() double-renders
 * the cut frame), VO loud over ducked music. Pure — no filesystem access.
 */
export function buildFfmpegArgs(opts: FfmpegBuildOpts): string[] {
  const { segs, clipPaths, voPath, musicPath, fontPath, outPath } = opts;
  if (segs.length !== clipPaths.length) {
    throw new Error(`segment/clip count mismatch: ${segs.length} segs vs ${clipPaths.length} clips`);
  }
  const total = segmentsTotalSeconds(segs);
  // drawtext fontfile: forward slashes + escaped ':' so a Windows drive letter
  // (C:/...) or any ':' in the path doesn't terminate the option early.
  const fontEsc = fontPath.replace(/\\/g, "/").replace(/:/g, "\\:");

  const inputs: string[] = [];
  clipPaths.forEach((p) => inputs.push("-i", p));
  const haveVo = !!voPath;
  const haveMusic = !!musicPath;
  if (haveVo) inputs.push("-i", voPath as string);
  if (haveMusic) inputs.push("-i", musicPath as string);
  const voIdx = clipPaths.length;
  const musIdx = clipPaths.length + (haveVo ? 1 : 0);

  const fc: string[] = [];
  // 1. normalize each beat to a trimmed vertical clip
  segs.forEach((s, i) => {
    fc.push(
      `[${i}:v]trim=0:${s.dur},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p[v${i}]`,
    );
  });
  // 2. concat all beats into one video stream
  fc.push(`${segs.map((_, i) => `[v${i}]`).join("")}concat=n=${segs.length}:v=1:a=0[vc]`);
  // 3. burn one caption per beat on a half-open time window
  // Brand styling: Anton (resolved upstream) in Nick's yellow #FDB913 on a
  // near-black box, raised out of IG's bottom caption / right-rail safe zone.
  // Beat 1 is the scroll-stopping HOOK — larger and screen-centered for its
  // window; later captions settle to the lower third (the muted-first read the
  // reel spec asks for).
  let cum = 0;
  let label = "vc";
  segs.forEach((s, i) => {
    const start = cum;
    const end = cum + s.dur;
    cum = end;
    const next = i === segs.length - 1 ? "vout" : `d${i}`;
    const isHook = i === 0;
    const size = isHook ? Math.round(s.fontSize * 1.35) : s.fontSize;
    const yPos = isHook ? "(h-text_h)/2" : "h*0.62";
    fc.push(
      `[${label}]drawtext=fontfile='${fontEsc}':text='${s.caption}':fontsize=${size}:fontcolor=0xFDB913:borderw=6:bordercolor=black:box=1:boxcolor=black@0.6:boxborderw=28:x=(w-text_w)/2:y=${yPos}:enable='gte(t,${start.toFixed(2)})*lt(t,${end.toFixed(2)})'[${next}]`,
    );
    label = next;
  });

  // 4. audio: VO loud over ducked music, degrading gracefully when either is absent
  const maps: string[] = ["-map", "[vout]"];
  if (haveVo && haveMusic) {
    fc.push(
      `[${voIdx}:a]volume=1.15[a0]`,
      `[${musIdx}:a]volume=0.16[a1]`,
      `[a0][a1]amix=inputs=2:duration=longest:normalize=0[am]`,
      `[am]atrim=0:${total},asetpts=PTS-STARTPTS,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`,
    );
    maps.push("-map", "[aout]");
  } else if (haveVo) {
    fc.push(`[${voIdx}:a]volume=1.15,atrim=0:${total},asetpts=PTS-STARTPTS,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`);
    maps.push("-map", "[aout]");
  } else if (haveMusic) {
    fc.push(`[${musIdx}:a]volume=0.5,atrim=0:${total},asetpts=PTS-STARTPTS,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`);
    maps.push("-map", "[aout]");
  }
  const hasAudio = maps.includes("[aout]");

  return [
    ...inputs,
    "-filter_complex",
    fc.join(";"),
    ...maps,
    "-r",
    "30",
    "-t",
    String(total),
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "medium",
    "-crf",
    "20",
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
    "-movflags",
    "+faststart",
    "-y",
    outPath,
  ];
}

// ─── I/O orchestration ──────────────────────────────────────────────

/**
 * drawtext needs a real .ttf on disk. Prefer an explicit override, then the
 * platform default: DejaVu (installed via the Railway build) on Linux, Arial
 * Bold on Windows dev boxes.
 */
export function resolveFontPath(): string {
  const override = process.env.REEL_FONT_PATH;
  if (override && fs.existsSync(override)) return override;
  const candidates =
    os.platform() === "win32"
      ? ["C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf"]
      : [
          "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
          "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
          "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0]; // let ffmpeg error loudly rather than silently drop text
}

let _antonFontPath: string | null = null;
/**
 * Resolve the reel caption font, preferring Nick's brand **Anton**. The Anton
 * TTF already ships base64-embedded for the Ad Studio (adStudio/adAssets) — we
 * materialize it once to a temp .ttf so ffmpeg `drawtext` can load it by path.
 * Order: REEL_FONT_PATH override -> materialized Anton -> platform default.
 * Never throws — any failure degrades to the platform font, never a missing
 * caption.
 */
export async function resolveReelFontPath(): Promise<string> {
  const override = process.env.REEL_FONT_PATH;
  if (override && fs.existsSync(override)) return override;
  try {
    if (_antonFontPath && fs.existsSync(_antonFontPath)) return _antonFontPath;
    const mod = (await import("./adStudio/adAssets")) as { ANTON_TTF_B64?: string };
    const raw = mod.ANTON_TTF_B64;
    if (raw && typeof raw === "string") {
      const b64 = raw.replace(/^data:[^,]+,/, ""); // tolerate a data: URI prefix
      const p = path.join(os.tmpdir(), "nt-reel-anton.ttf");
      if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.from(b64, "base64"));
      _antonFontPath = p;
      return p;
    }
  } catch (e) {
    log.warn("Anton font unavailable — using platform font", { e: e instanceof Error ? e.message : String(e) });
  }
  return resolveFontPath();
}

/**
 * Probe a finished MP4 for the publish-gate hardening check (dimensions /
 * duration / audio presence). Throws on a malformed probe so the caller can
 * fail the job instead of shipping a broken reel.
 */
function ffprobeReel(file: string): Promise<{ width: number; height: number; duration: number; hasAudio: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=width,height,codec_type",
      "-show_entries", "format=duration",
      "-of", "json",
      file,
    ]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.slice(-300)}`));
      try {
        const j = JSON.parse(out) as {
          streams?: Array<{ width?: number; height?: number; codec_type?: string }>;
          format?: { duration?: string };
        };
        const v = (j.streams ?? []).find((s) => s.codec_type === "video");
        const hasAudio = (j.streams ?? []).some((s) => s.codec_type === "audio");
        resolve({
          width: Number(v?.width ?? 0),
          height: Number(v?.height ?? 0),
          duration: Number(j.format?.duration ?? 0),
          hasAudio,
        });
      } catch (e) {
        reject(new Error(`ffprobe parse failed: ${e instanceof Error ? e.message : String(e)}`));
      }
    });
  });
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed ${r.status} for ${url}`);
  await fs.promises.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}

function runFfmpeg(args: string[], timeoutMs = 5 * 60 * 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args);
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg timed out"));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`));
    });
  });
}

export interface AssembleResult {
  mp4Url: string;
  durationSec: number;
  usedVo: boolean;
}

/**
 * Assemble a finished reel MP4 from a brief + its re-hosted clip URLs: download
 * clips, generate a VO (degradable), run the proven ffmpeg recipe, and re-host
 * the result via storagePut (public /generated URL — Meta-fetchable). Does NOT
 * publish — that's a separate, separately-gated stage.
 */
/**
 * Pick a background music bed for the reel. Prefers a committed loop in
 * apps/nickstire/assets/reel-music whose filename matches the brief's
 * archetype/tone; otherwise rotates deterministically (a given reel always gets
 * the same bed). Returns an absolute path, or null when no beds are committed —
 * assembly then degrades gracefully to a VO-only reel (never a silent/broken
 * publish). Drop more .mp3/.wav loops into that folder and they're used automatically.
 */
export function pickMusicBed(brief: ReelAssemblyBrief): string | null {
  try {
    const dir = [
      path.resolve(process.cwd(), "assets/reel-music"),
      path.resolve(process.cwd(), "apps/nickstire/assets/reel-music"),
    ].find((d) => fs.existsSync(d));
    if (!dir) return null;
    const beds = fs.readdirSync(dir).filter((f) => /\.(mp3|wav|m4a)$/i.test(f)).sort();
    if (beds.length === 0) return null;
    const tone = String(
      (brief as { archetype?: string; tone?: string }).archetype ?? (brief as { tone?: string }).tone ?? "",
    ).toLowerCase();
    const matched = tone ? beds.find((b) => b.toLowerCase().includes(tone)) : undefined;
    if (matched) return path.join(dir, matched);
    const seed = String((brief as { id?: string | number }).id ?? brief.voiceoverScript ?? "");
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return path.join(dir, beds[h % beds.length]);
  } catch {
    return null;
  }
}

export async function assembleReel(
  brief: ReelAssemblyBrief,
  clipUrls: string[],
  jobId: number | string,
): Promise<AssembleResult> {
  const segs = briefToSegments(brief);
  if (segs.length !== clipUrls.length) {
    throw new Error(`assemble: ${segs.length} beats but ${clipUrls.length} clips — gen stage incomplete`);
  }
  const total = segmentsTotalSeconds(segs);
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `reel-${jobId}-`));
  try {
    const clipPaths: string[] = [];
    for (let i = 0; i < clipUrls.length; i++) {
      const p = path.join(workDir, `clip-${i}.mp4`);
      await downloadTo(clipUrls[i], p);
      clipPaths.push(p);
    }

    const { generateVoiceover } = await import("./reelVoice");
    const vo = await generateVoiceover(brief.voiceoverScript);
    let voPath: string | null = null;
    if (vo) {
      voPath = path.join(workDir, `vo.${vo.ext}`);
      await fs.promises.writeFile(voPath, vo.buf);
    }

    const outPath = path.join(workDir, "reel.mp4");
    const fontPath = await resolveReelFontPath();
    const args = buildFfmpegArgs({ segs, clipPaths, voPath, musicPath: pickMusicBed(brief), fontPath, outPath });
    log.info("assembling reel", { jobId, beats: segs.length, total, usedVo: !!voPath });
    await runFfmpeg(args);

    // Publish-gate hardening: never ship a corrupt / wrong-aspect / silent reel.
    // A failed assertion throws -> the job fails loudly instead of publishing garbage.
    const probe = await ffprobeReel(outPath);
    if (probe.width !== 1080 || probe.height !== 1920) {
      throw new Error(`assembled reel wrong dimensions ${probe.width}x${probe.height} (expected 1080x1920)`);
    }
    if (!(probe.duration >= 3 && probe.duration <= 90)) {
      throw new Error(`assembled reel duration ${probe.duration}s out of the 3-90s range`);
    }
    if (voPath && !probe.hasAudio) {
      throw new Error("assembled reel has a VO input but no audio stream — mux failed");
    }

    const mp4 = await fs.promises.readFile(outPath);
    const { storagePut } = await import("../storage");
    // Unique basename per job: the no-S3 fallback serves by basename only
    // (storagePut does path.basename), so a constant "reel.mp4" would make every
    // job overwrite the same data/generated/reel.mp4. reel-<jobId>.mp4 keeps them distinct.
    const put = await storagePut(`reels/reel-${jobId}.mp4`, mp4, "video/mp4");
    log.info("reel assembled", { jobId, bytes: mp4.length, url: put.url });
    return { mp4Url: put.url, durationSec: total, usedVo: !!voPath };
  } finally {
    fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
