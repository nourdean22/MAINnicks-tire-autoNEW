/**
 * Professional edit planning (directive Part XI) — begins with SOURCE-CLIP
 * ANALYSIS (§42). The baseline's "editing" was blind concatenation: every
 * generated clip trimmed to a fixed window regardless of what the frames
 * actually showed. Real editing selects trims from measured content — where
 * the clip is frozen, where it moves, how bright it is.
 *
 * This module measures ACTUAL FRAMES with ffmpeg (freezedetect + signalstats)
 * and produces a SourceClipAnalysis the future ReelEditPlan consumes. Pure
 * measurement, deterministic, unit-tested against clips with known ground
 * truth. No model, no guessing.
 */
import { spawn } from "child_process";
import { createLogger } from "../lib/logger";

const log = createLogger("services:edit-planner");

export interface FrozenSpan { startSec: number; endSec: number }

export interface SourceClipAnalysis {
  path: string;
  durationSec: number;
  /** spans where the picture holds still (dead frames the editor should trim) */
  frozenSpans: FrozenSpan[];
  frozenFraction: number;
  /** mean luma 0-255 across sampled frames; low = underexposed */
  meanBrightness: number;
  /** temporal difference proxy 0-1 — higher means more motion */
  motionScore: number;
  /** best contiguous non-frozen window for a trim, or null if all frozen */
  usableInSec: number | null;
  usableOutSec: number | null;
  verdict: "good" | "static" | "dark" | "unusable";
}

function ffmpegStderr(args: string[], timeoutMs = 60_000): Promise<string> {
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

/** Parse freezedetect stderr into frozen spans. */
export function parseFreezeSpans(stderr: string, durationSec: number): FrozenSpan[] {
  const spans: FrozenSpan[] = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = line.match(/freeze_start:\s*([\d.]+)/);
    if (s) { open = Number(s[1]); continue; }
    const e = line.match(/freeze_end:\s*([\d.]+)/);
    if (e && open !== null) { spans.push({ startSec: open, endSec: Number(e[1]) }); open = null; }
  }
  if (open !== null) spans.push({ startSec: open, endSec: durationSec });
  return spans;
}

/** Mean of all YAVG values signalstats prints (one per frame). */
export function meanFromSignalstats(stderr: string): number {
  const vals: number[] = [];
  for (const m of stderr.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)) vals.push(Number(m[1]));
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * Compose the analysis from freeze spans + brightness + duration. Pure so the
 * verdict logic is unit-tested independent of ffmpeg.
 */
export function composeAnalysis(input: {
  path: string;
  durationSec: number;
  frozenSpans: FrozenSpan[];
  meanBrightness: number;
}): SourceClipAnalysis {
  const { path, durationSec, frozenSpans, meanBrightness } = input;
  const frozenSec = frozenSpans.reduce((a, s) => a + (s.endSec - s.startSec), 0);
  const frozenFraction = durationSec > 0 ? Math.min(1, frozenSec / durationSec) : 1;
  const motionScore = Math.max(0, 1 - frozenFraction);

  // Best non-frozen window: the largest gap between frozen spans.
  let usableInSec: number | null = null;
  let usableOutSec: number | null = null;
  let bestLen = 0;
  const sorted = [...frozenSpans].sort((a, b) => a.startSec - b.startSec);
  let cursor = 0;
  for (const span of [...sorted, { startSec: durationSec, endSec: durationSec }]) {
    const gap = span.startSec - cursor;
    if (gap > bestLen) { bestLen = gap; usableInSec = cursor; usableOutSec = span.startSec; }
    cursor = Math.max(cursor, span.endSec);
  }
  if (bestLen < 0.5) { usableInSec = null; usableOutSec = null; }

  let verdict: SourceClipAnalysis["verdict"] = "good";
  if (usableInSec === null) verdict = "unusable";
  else if (frozenFraction > 0.6) verdict = "static";
  else if (meanBrightness < 30) verdict = "dark";

  return { path, durationSec, frozenSpans, frozenFraction, meanBrightness, motionScore, usableInSec, usableOutSec, verdict };
}

/** Measure a source clip end-to-end (ffprobe duration + freezedetect + signalstats). */
export async function analyzeSourceClip(clipPath: string): Promise<SourceClipAnalysis> {
  const probe = await ffmpegStderr(["-i", clipPath, "-f", "null", "-"]).catch(() => "");
  const durMatch = probe.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const durationSec = durMatch ? Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]) : 0;

  const freezeErr = await ffmpegStderr(["-i", clipPath, "-vf", "freezedetect=n=0.003:d=0.5", "-map", "0:v:0", "-f", "null", "-"]);
  const frozenSpans = parseFreezeSpans(freezeErr, durationSec);

  const statsErr = await ffmpegStderr(["-i", clipPath, "-vf", "signalstats,metadata=print", "-map", "0:v:0", "-f", "null", "-"]);
  const meanBrightness = meanFromSignalstats(statsErr);

  const analysis = composeAnalysis({ path: clipPath, durationSec, frozenSpans, meanBrightness });
  log.info("source clip analyzed", { path: clipPath, verdict: analysis.verdict, frozenFraction: analysis.frozenFraction.toFixed(2), brightness: Math.round(meanBrightness) });
  return analysis;
}
