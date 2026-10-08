/**
 * Faceless Reel assembly — PURE ffmpeg/segment logic (no I/O).
 *
 * Ported from the proven scratch/assemble-reel.ts recipe that produced the 3
 * reels posted live to @nicks_tire_euclid. Keeping the ffmpeg-arg construction
 * pure makes it unit-testable without spawning ffmpeg; the I/O orchestration
 * (clip download, VO/music gen, ffmpeg spawn, storagePut) is the orchestration
 * section at the bottom of this file.
 */
import type { ClipProbe } from "../../shared/clipDrift";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { createLogger } from "../lib/logger";
import { askProblem, askLeakageProblem, renderAskText, resolveReelAsk, type ReelAsk } from "@shared/reelAsk";
import { declaredTextSurfaces, undeclaredTextProblem } from "@shared/reelTextSurfaces";
import { REEL_OUTPUT_RULES } from "../../client/src/lib/facelessReelStudio";

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
  /**
   * The declared end-card ask. Undeclared renders NO card — there is
   * deliberately no inference from campaignKeyword any more (shared/reelAsk.ts
   * explains why: it silently produced the one ask nothing answers, and it
   * reopened the payload-vs-render truth gap).
   */
  ask?: ReelAsk | null;
  /** Retained for topic/telemetry use. It NO LONGER drives the end card. */
  campaignKeyword?: string;
}

export interface ReelSegment {
  beatNumber: number;
  dur: number;
  caption: string;
  fontSize: number;
}

/**
 * seedance clips render at ~4s — never trim a beat longer than its source clip.
 *
 * RE-EXPORTED, NOT REDECLARED (2026-09-07). This was a second literal `4` living here
 * while `REEL_OUTPUT_RULES` described the storyboard band elsewhere, so nothing tied
 * the ACCEPTED duration to the RENDERABLE one. Raising `maxSeconds` 22 -> 35 made that
 * gap load-bearing: a brief may now declare 35s, but this is still what reaches the
 * screen, and `briefToSegments` clamps to it. One definition, imported.
 */
export const MAX_CLIP_SECONDS: number = REEL_OUTPUT_RULES.maxClipSeconds;
const MIN_BEAT_SECONDS = 0.8;
const DEFAULT_BEAT_SECONDS = 3;
/** Phase 3.1 save-payload: hold the final frame this long. The overlay text is
 *  no longer built here — it comes from the declared ask (shared/reelAsk.ts).
 *
 *  Re-exported, not redeclared: the preflight voiceover gate has to budget
 *  against `beats + this`, because that is what the voice track is trimmed to. */
export const SAVE_FREEZE_SECONDS: number = REEL_OUTPUT_RULES.saveFreezeSeconds;

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
  // The caption is written to caption_N.txt and drawn via drawtext `textfile=`
  // (see buildFfmpegArgs) — so ONLY the filename sits in the single-quoted
  // filtergraph value, never the caption text. That means an apostrophe in the
  // text is SAFE (the old code deleted it, turning "TIRE'S" into "TIRES" and
  // changing the meaning — observed live 2026-07-16). Still strip `\` and `%`:
  // drawtext expands `%{...}` and treats `\` as an escape even in textfile mode.
  return (raw ?? "")
    .replace(/[\\%]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Longest word-count target per line for a comfortable mobile caption. */
const CAPTION_MAX_CHARS_PER_LINE = 20;

/**
 * Wrap a caption to AT MOST two lines at word boundaries, balancing length so
 * neither line runs off a 9:16 phone frame. drawtext renders literal newlines
 * in a textfile as centered line breaks, so the returned "\n" is safe. A single
 * word longer than the budget keeps its own line rather than being hyphenated.
 * Captions that already fit on one line are returned unchanged.
 */
export function wrapCaption(caption: string, maxPerLine = CAPTION_MAX_CHARS_PER_LINE): string {
  const text = caption.trim();
  if (text.length <= maxPerLine || !text.includes(" ")) return text;
  const words = text.split(" ");
  // Find the split point that best balances the two lines (minimizes the
  // longer line), preferring splits where both lines fit the budget.
  let best = { line1: text, line2: "", longest: text.length, bothFit: false };
  for (let i = 1; i < words.length; i++) {
    const line1 = words.slice(0, i).join(" ");
    const line2 = words.slice(i).join(" ");
    const longest = Math.max(line1.length, line2.length);
    const bothFit = line1.length <= maxPerLine && line2.length <= maxPerLine;
    // Prefer a split where both lines fit; among those (or if none fit) pick the
    // most balanced (smallest longest line).
    if ((bothFit && !best.bothFit) || (bothFit === best.bothFit && longest < best.longest)) {
      best = { line1, line2, longest, bothFit };
    }
  }
  return best.line2 ? `${best.line1}\n${best.line2}` : best.line1;
}

/** Bigger text for short punchy captions, smaller for long ones (proven 44-64
 *  band). Sizes by the LONGEST line so a wrapped two-line caption isn't shrunk
 *  by its total (newline-inclusive) length. */
export function captionFontSize(caption: string): number {
  const len = Math.max(...caption.split("\n").map((l) => l.length), 0);
  if (len <= 14) return 64;
  if (len <= 20) return 56;
  if (len <= 28) return 50;
  return 44;
}

// ─── Caption safe-zone (pixel-width cap) ────────────────────────────
// The published reel's hook ran EDGE TO EDGE (baseline finding
// caption-safezone-001): band sizing alone cannot guarantee width, because
// the hook's ×1.35 multiplier lands AFTER the band — a 28-char hook line at
// 50×1.35=68px estimates ~1100px on a 1080 frame. The cap below makes
// overflow mathematically impossible down to the readability floor, using a
// conservative per-char advance (0.58em covers Anton/Arial-Bold uppercase —
// verified by rendering the worst case and inspecting the frame).
export const CAPTION_SAFE = {
  frameW: 1080,
  /** max text-box fraction of frame width (margins live in the remainder) */
  maxWidthFrac: 0.82,
  /** conservative average glyph advance per char, in ems, for UPPERCASE bold.
   *  Real measurement (cropdetect on Arial Bold, the widest face we render):
   *  0.587em — 0.60 keeps real pixels under budget with headroom. */
  charAspect: 0.6,
  /** drawtext boxborderw=28 on both sides */
  boxPadPx: 56,
  /** readability floor — below this we log loudly rather than shrink further */
  minFontPx: 34,
} as const;

/**
 * Vertical anchor of every NON-hook beat caption, as a fraction of frame
 * height (drawtext `y=h*0.62`). The hook caption is vertically centred
 * instead. Exported so the deterministic pixel checks (renderedPixelStats)
 * inspect the SAME band the overlay is drawn into, rather than a second
 * hand-copied number that drifts the day this one moves.
 */
export const CAPTION_BEAT_Y_FRAC = 0.62;

/** Estimated rendered text-box width in px for the caption's longest line. */
export function estimateCaptionWidthPx(caption: string, fontSize: number): number {
  const longest = Math.max(...caption.split("\n").map((l) => l.length), 0);
  return Math.round(longest * CAPTION_SAFE.charAspect * fontSize) + CAPTION_SAFE.boxPadPx;
}

/**
 * Cap a proposed font size so the caption's longest line fits inside the safe
 * width. Apply AFTER any hook multiplier — the cap must see the final size.
 */
export function capFontSizeToSafeWidth(caption: string, proposedSize: number): number {
  const longest = Math.max(...caption.split("\n").map((l) => l.length), 0);
  if (longest === 0) return proposedSize;
  const budgetPx = CAPTION_SAFE.frameW * CAPTION_SAFE.maxWidthFrac - CAPTION_SAFE.boxPadPx;
  const maxSize = Math.floor(budgetPx / (longest * CAPTION_SAFE.charAspect));
  const capped = Math.min(proposedSize, maxSize);
  if (capped < CAPTION_SAFE.minFontPx) {
    log.warn("caption cannot fit safe width even at the floor font — rendering at floor", {
      caption: caption.slice(0, 60), longest, proposedSize, floor: CAPTION_SAFE.minFontPx,
    });
    return CAPTION_SAFE.minFontPx;
  }
  return capped;
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
    const caption = wrapCaption(sanitizeCaption(b.onScreenText ?? ""));
    return { beatNumber: b.beatNumber, dur: Number(dur.toFixed(2)), caption, fontSize: captionFontSize(caption) };
  });
}

export function segmentsTotalSeconds(segs: ReelSegment[]): number {
  return Number(segs.reduce((a, s) => a + s.dur, 0).toFixed(2));
}

/**
 * Render-integrity verdict — the check that would have caught the frozen-reel
 * defect (2026-07-17: a 25s container with only 72 unique frames shipped and
 * published because the gate only looked at dimensions/duration-band/audio).
 * Pure so it is unit-testable; the caller supplies probe numbers + sampled
 * frame hashes.
 *
 *  - duration must match the storyboard contract (beats + freeze), not just
 *    fall in a loose 3-90s band;
 *  - the video stream must actually CONTAIN ~30fps worth of frames;
 *  - frames sampled across the timeline must differ — a reel is motion, and
 *    identical samples mean the viewer is staring at one held frame.
 */
export function evaluateRenderIntegrity(input: {
  durationSec: number;
  videoStreamSec?: number;
  nbFrames: number;
  expectedSec: number;
  frameHashes: string[];
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const { durationSec, videoStreamSec, nbFrames, expectedSec, frameHashes } = input;
  // The container can report full length via the AUDIO track while the video
  // track ends early (ffmpeg 5.x tpad PTS drop) - judge the video stream itself.
  if (typeof videoStreamSec === "number" && videoStreamSec > 0 && videoStreamSec < expectedSec - 0.75) {
    reasons.push(`video stream ends at ${videoStreamSec.toFixed(2)}s but the storyboard contract is ${expectedSec.toFixed(2)}s - the tail is missing`);
  }
  if (Math.abs(durationSec - expectedSec) > 0.75) {
    reasons.push(`duration ${durationSec.toFixed(2)}s deviates from the storyboard contract ${expectedSec.toFixed(2)}s by more than 0.75s`);
  }
  // nb_frames can be unreported (0) by some containers — only judge when known.
  const minFrames = Math.floor(0.8 * 30 * expectedSec);
  if (nbFrames > 0 && nbFrames < minFrames) {
    reasons.push(`video stream has ${nbFrames} frames — a real ${expectedSec.toFixed(1)}s/30fps reel needs at least ~${minFrames}; this renders as a frozen image`);
  }
  const distinct = new Set(frameHashes.filter(Boolean)).size;
  if (frameHashes.length >= 3 && distinct < 3) {
    reasons.push(`only ${distinct} distinct frame(s) across ${frameHashes.length} timeline samples — no motion`);
  }
  return { ok: reasons.length === 0, reasons };
}

export interface FfmpegBuildOpts {
  segs: ReelSegment[];
  clipPaths: string[];
  voPath: string | null;
  musicPath: string | null;
  assPath: string | null;
  fontPath: string;
  outPath: string;
  /**
   * The single declared end-card ask, already rendered to its final line.
   * Null draws NO end card - which is the correct outcome when nothing declared
   * one. This used to be built inside the assembler from `campaignKeyword`,
   * which is how `SAVE THIS | DM "SALT"` reached the frame of reel 1770003
   * while its payload declared only five beats. See shared/reelTextSurfaces.ts.
   */
  askText?: string | null;
}

/**
 * Build the ffmpeg arg vector for a vertical 1080x1920 captioned reel.
 * Mirrors scratch/assemble-reel.ts: per-beat trim->scale->crop->concat, captions
 * burned on HALF-OPEN [start,end) intervals (inclusive between() double-renders
 * the cut frame), VO loud over ducked music. Pure — no filesystem access.
 */
export function buildFfmpegArgs(opts: FfmpegBuildOpts): string[] {
  const { segs, clipPaths, voPath, musicPath, assPath, fontPath, outPath } = opts;
  if (segs.length !== clipPaths.length) {
    throw new Error(`segment/clip count mismatch: ${segs.length} segs vs ${clipPaths.length} clips`);
  }
  const total = segmentsTotalSeconds(segs);
  const videoTotal = Number((total + SAVE_FREEZE_SECONDS).toFixed(2));
  // The font is copied to the working directory so it's just 'font.ttf'.
  // No Windows drive letter colon escaping hell.
  const fontEsc = fontPath.replace(/\\/g, "/");

  const inputs: string[] = [];
  clipPaths.forEach((p) => inputs.push("-i", p));
  const haveVo = !!voPath;
  const haveMusic = !!musicPath;
  if (haveVo) inputs.push("-i", voPath as string);
  if (haveMusic) inputs.push("-i", musicPath as string);
  const voIdx = clipPaths.length;
  const musIdx = clipPaths.length + (haveVo ? 1 : 0);

  const fc: string[] = [];
  // 1. normalize each beat to a trimmed vertical 30fps clip. NO zoompan: the
  //    Ken Burns stage was built for STATIC AI stills, but zoompan regenerates
  //    PTS in a way that poisons chained xfade offsets - the live 2026-07-17
  //    render came out 156 frames spread across a 1231s container (players
  //    hold one frame = "one image the whole time"). Seedance clips carry
  //    native motion; removing zoompan yields exact-duration output (bisect-
  //    verified locally on the real job-630001 clips: 528 frames / 22.0s).
  const XFADE_DUR = 0.5;
  const XFADE_TRANSITION = "fade";

  // 1. base sizing + Ken Burns pan/zoom + extend for xfade
  segs.forEach((s, i) => {
    const pad = i < segs.length - 1 ? `:stop_duration=${XFADE_DUR}` : "";
    fc.push(
      // fps=30 FIRST: Seedance sources are 24fps, and zoompan re-times N input
      // frames to N output frames AT ITS fps= SETTING - on a 24fps source that
      // silently shrank every beat by 20%, so the second-based xfade offsets
      // pointed past each stream's end and tpad=clone froze the remainder
      // (observed live 2026-07-17: 25s render with 72 unique frames - "one
      // image the whole time"). Normalizing to the graph's 30fps contract up
      // front keeps native clip motion and the downstream time math honest.
      `[${i}:v]trim=0:${s.dur},setpts=PTS-STARTPTS,fps=30,` +
        `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
        `setsar=1,format=yuv420p,` +
        `tpad=stop_mode=clone${pad}[v${i}]`,
    );
  });
  // 2. xfade all beats into one video stream
  if (segs.length > 1) {
    let prev = "[v0]";
    let cumOffset = 0;
    for (let i = 1; i < segs.length; i++) {
      cumOffset += segs[i - 1].dur;
      const next = `[v${i}]`;
      const out = i === segs.length - 1 ? "[vc]" : `[xf${i}]`;
      fc.push(`${prev}${next}xfade=transition=${XFADE_TRANSITION}:duration=${XFADE_DUR}:offset=${cumOffset.toFixed(2)}${out}`);
      prev = out;
    }
  } else {
    fc.push(`[v0]copy[vc]`);
  }
  // 3. burn one caption per beat on a half-open time window, OR use dynamic ASS captions if available
  if (assPath) {
    // Escape for ffmpeg: backslashes become forward slashes, Windows drive letters (C:) need escaping
    const assEsc = assPath.replace(/\\/g, "/").replace(/:/g, "\\\\:");
    fc.push(`[vc]subtitles='${assEsc}':fontsdir='${path.dirname(fontEsc)}'[vcap]`);
  } else {
    let cum = 0;
    let label = "vc";
    segs.forEach((s, i) => {
      const start = cum;
      const end = cum + s.dur;
      cum = end;
      const next = i === segs.length - 1 ? "vcap" : `d${i}`;
      const isHook = i === 0;
      // Width cap AFTER the hook multiplier — the safe zone must see the
      // final size (caption-safezone-001: band sizing alone let long hooks
      // run edge-to-edge on the published reel).
      const size = capFontSizeToSafeWidth(s.caption, isHook ? Math.round(s.fontSize * 1.35) : s.fontSize);
      // ONE drawtext PER LINE: drawtext renders the LF control char as a tofu
      // box with some fonts/builds even while breaking the line (observed on
      // a real render of a wrapped caption — two-line captions have never
      // shipped through prod, so this was a live defect waiting). Per-line
      // runs contain no control characters anywhere. Files are
      // caption_<beat>_<line>.txt, stacked at a 1.2em line height.
      const lines = s.caption.split("\n");
      const lineH = Math.round(size * 1.2);
      lines.forEach((_line, j) => {
        const stepIn = j === 0 ? label : `d${i}l${j}`;
        const stepOut = j === lines.length - 1 ? next : `d${i}l${j + 1}`;
        const yExpr = isHook
          ? `(h-${lines.length * lineH})/2+${j * lineH}`
          : `h*${CAPTION_BEAT_Y_FRAC}+${j * lineH}`;
        fc.push(
          `[${stepIn}]drawtext=fontfile='${fontEsc}':textfile='caption_${i}_${j}.txt':fontsize=${size}:fontcolor=0xFDB913:borderw=6:bordercolor=black:box=1:boxcolor=black@0.6:boxborderw=28:x=(w-text_w)/2:y=${yExpr}:enable='gte(t,${start.toFixed(2)})*lt(t,${end.toFixed(2)})'[${stepOut}]`,
        );
      });
      label = next;
    });
  }

  // 3b. Phase 3.1 save-payload: freeze the final frame for SAVE_FREEZE_SECONDS and
  //     stamp a top-of-frame "SAVE THIS" prompt (works muted; a save is a top Meta
  //     reach lever). tpad clone-holds the last rendered frame; the overlay shows
  //     only during the freeze window so it never collides with beat captions.
  // setpts AFTER the freeze-tpad: on ffmpeg 5.x (the prod image) tpad's cloned
  // frames carry non-advancing PTS and the encoder silently DROPS them - the
  // reassembled 630001 render lost its entire 3s SAVE tail (video stream ended
  // at 22.03s inside a 25s container; verified by packet PTS). Re-deriving
  // PTS from the frame index (N/30) gives clones real timestamps on every
  // ffmpeg version; on 8.x it is an identity transform.
  fc.push(`[vcap]tpad=stop_mode=clone:stop_duration=${SAVE_FREEZE_SECONDS},setpts=N/30/TB[vpad]`);
  // The freeze is unconditional so the duration contract and the render-integrity
  // gate (expectedSec = total + SAVE_FREEZE_SECONDS) are unaffected. Only the
  // CARD is conditional: no declared ask means no burned-in ask.
  // 3b. OPTICAL FINISH - the one thing that separates a render from footage.
  //
  // A generated clip is perfectly smooth. Real footage never is: a sensor adds
  // grain that MOVES between frames, and a lens darkens toward the corners.
  // Their absence is a large part of what "looks AI-generated" means, and no
  // amount of prompt engineering puts them back - they are properties of the
  // camera, not of the scene.
  //
  // WHAT IS DELIBERATELY NOT HERE, and why - each measured rather than assumed,
  // on a 1080x1920 synthetic source with a flat brand-gold subject:
  //
  //   colour grade / temperature   REJECTED. A global warm grade is the exact
  //     mistake LENS_PALETTES exists to undo: fourteen lens worlds, one look
  //     imposed over all of them. The grade belongs to the lens.
  //   highlight bloom / halation   REJECTED. Screening a blurred luma layer
  //     lifts luma by +0.2 and costs ~10% SATURATION - it washes Nick yellow,
  //     the one colour that must survive. Measured at two thresholds; both
  //     cost the saturation and neither delivered visible glow.
  //   chromatic aberration         REJECTED, and this one was a surprise.
  //     rgbashift LOOKS like free lens realism and measured SATAVG 44.0 -> 39.8,
  //     a 9.5% desaturation of the hero, for a 1px edge fringe. Not worth it.
  //
  // WHAT SURVIVED, measured on the same source (source YAVG 147.05, SATAVG 44.0):
  //   noise=c0s (LUMA PLANE ONLY)  YAVG 146.5, SATAVG 44.0 - zero saturation
  //     cost at every strength tried. `allf=t+u` is what makes it move frame to
  //     frame; a static pattern reads as dirt on the lens, not as grain.
  //     Applying it to all planes instead costs ~12% saturation, because chroma
  //     noise steals bitrate from chroma at a fixed CRF.
  //   vignette=PI/12               YAVG 146.2, SATAVG 43.8 - subtle corner
  //     falloff. PI/9 was visibly heavy; PI/12 reads as a lens, not a filter.
  //   Together: YAVG 145.6, SATAVG 43.8. The image survives; the plastic
  //     surface does not.
  //
  // DEFAULT OFF, and that is not timidity. Grain is incompressible by design,
  // and on that same smooth source it took the file from 124KB to 320KB - 2.57x
  // at identical CRF. Instagram RE-ENCODES every upload, so grain competes for
  // bitrate with the image itself and can leave the reel looking WORSE after
  // their transcode than it did before. Real footage carries detail for the
  // grain to hide behind and should cost far less, but that has not been
  // measured on a real reel, and shipping an unmeasured bitrate multiplier to
  // every published asset is not a call to make silently. Arm it with
  // REEL_FILM_GRAIN=true and compare a real pair.
  //
  // Placed BEFORE the caption overlay so the burned-in text stays clean: real
  // grain lives in the photographed image, and graphics go on top of it.
  fc.push(`[vpad]${opticalFinishFilter()}[vmaster]`);
  if (opts.askText) {
    fc.push(
      `[vmaster]drawtext=fontfile='${fontEsc}':textfile='caption_save.txt':fontsize=72:fontcolor=0xFDB913:borderw=6:bordercolor=black:box=1:boxcolor=black@0.6:boxborderw=28:x=(w-text_w)/2:y=h*0.12:enable='gte(t,${total.toFixed(2)})'[vout]`,
    );
  } else {
    fc.push(`[vmaster]null[vout]`);
  }

  // 4. audio: VO loud over ducked music, degrading gracefully when either is absent
  const maps: string[] = ["-map", "[vout]"];
  if (haveVo && haveMusic) {
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
    fc.push(
      `[${voIdx}:a]aresample=48000,volume=1.15,asplit=2[vo_mix][vo_key]`,
      `[vo_key]apad=whole_dur=${videoTotal}[vo_key_p]`,
      `[${musIdx}:a]aloop=loop=-1:size=4000000,aresample=48000,volume=0.6,atrim=0:${videoTotal}[mus_raw]`,
      `[mus_raw][vo_key_p]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[mus_duck]`,
      `[vo_mix][mus_duck]amix=inputs=2:duration=longest:normalize=0[am]`,
      `[am]atrim=0:${videoTotal},asetpts=PTS-STARTPTS,apad=whole_dur=${videoTotal},loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`,
    );
    maps.push("-map", "[aout]");
  } else if (haveVo) {
    // aresample FIRST so loudnorm computes the apad/duration on a known 48k rate.
    // NOTE: this branch pads everything after the VO with silence — acceptable
    // only for VO that spans (most of) the video. The dead-air render gate in
    // assembleReel refuses the result otherwise.
    fc.push(`[${voIdx}:a]aresample=48000,volume=1.15,atrim=0:${videoTotal},asetpts=PTS-STARTPTS,apad=whole_dur=${videoTotal},loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`);
    maps.push("-map", "[aout]");
  } else if (haveMusic) {
    // Loop the bed here too — a 60s bed under a 90s reel must not die at 60s.
    fc.push(`[${musIdx}:a]aloop=loop=-1:size=4000000,aresample=48000,volume=0.5,atrim=0:${videoTotal},asetpts=PTS-STARTPTS,apad=whole_dur=${videoTotal},loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`);
    maps.push("-map", "[aout]");
  }
  const hasAudio = maps.includes("[aout]");

  const filterStr = fc.join(";");
  log.debug("=== FFmpeg Filtergraph ===");
  log.debug(filterStr);
  log.debug("==========================");

  return [
    ...inputs,
    "-filter_complex",
    filterStr,
    ...maps,
    "-r",
    "30",
    "-t",
    String(videoTotal),
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
    // TAG THE COLOUR SPACE. The encode wrote UNTAGGED H.264, which is not a
    // neutral choice - it is an ambiguous one. Every decoder then guesses, and
    // they do not guess alike: Instagram's transcoder, Safari, Chrome and QuickTime
    // each apply their own default matrix to untagged 8-bit 4:2:0. The reel that
    // looked right in the render can arrive on a phone washed out, crushed or
    // shifted in hue, and nothing upstream would ever show it, because our own QA
    // reads the same untagged file with the same assumption that produced it.
    //
    // Rec.709 is the correct declaration for this pipeline: the sources are 8-bit
    // SDR, the deliverable is 1080x1920 SDR, and 709 is the HD standard every
    // consumer surface expects. This tags what we are ALREADY producing; it does
    // not convert anything, so no existing render changes appearance - it stops
    // the guessing.
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-color_range",
    "tv",
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k", "-ac", "2"] : ["-an"]),
    "-movflags",
    "+faststart",
    "-y",
    outPath,
  ];
}

/**
 * Grain strength on the LUMA plane.
 *
 * 8, chosen from a measured cost curve on a REAL published reel rather than
 * from taste. Grain is incompressible and the price is sharply non-linear, so
 * the setting is a cliff-edge decision, not a dial:
 *
 *    6 -> 1.18x file size      9 -> 2.19x
 *    8 -> 1.57x              10 -> 3.34x
 *                            12 -> 6.40x
 *
 * The knee sits immediately after 8. Twelve looks the most filmic and produced
 * a 52.8 MB file from an 8.2 MB source - large enough that it exceeded a phone
 * upload limit, which is a fair proxy for what Instagram's transcoder would do
 * to it. Eight is the most texture available before the curve turns.
 *
 * NOTE the earlier figure this replaces: a synthetic smooth-gradient test put
 * grain at 2.57x, and that number is what kept the whole feature off. Real
 * footage carries detail for grain to hide behind, so the true cost at the
 * shipped strength is 1.18x. Measure on the real thing.
 */
export const FILM_GRAIN_STRENGTH = 8;

/**
 * The optical finish, or a no-op when it is not armed.
 *
 * Returns a filter string rather than a boolean so the caller cannot
 * accidentally build an empty link label: ffmpeg needs SOMETHING between
 * [vpad] and [vmaster], and "null" is that something.
 */
export function opticalFinishFilter(): string {
  if (process.env.REEL_FILM_GRAIN !== "true") return "null";
  return `noise=c0s=${FILM_GRAIN_STRENGTH}:allf=t+u,vignette=PI/12`;
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
/** MD5 of the single decoded frame at `atSec` — cheap motion forensics. */
function hashFrameAt(file: string, atSec: number, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const bin = process.env.FFMPEG_PATH || "ffmpeg";
    const child = spawn(bin, ["-v", "error", "-ss", String(atSec), "-i", file, "-frames:v", "1", "-f", "md5", "-"], {
      cwd,
      shell: process.platform === "win32" && !process.env.FFMPEG_PATH,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    // Best-effort: an unhashable sample resolves empty and the evaluator
    // simply has one fewer sample — never blocks assembly by itself.
    child.on("error", () => resolve(""));
    child.on("close", () => {
      const m = out.match(/MD5=([0-9a-f]+)/i);
      resolve(m ? m[1] : "");
    });
  });
}

function ffprobeReel(file: string): Promise<{ width: number; height: number; duration: number; hasAudio: boolean; nbFrames: number; videoStreamSec: number }> {
  return new Promise((resolve, reject) => {
    const bin = process.env.FFPROBE_PATH || "ffprobe";
    const child = spawn(bin, [
      "-v", "error",
      "-show_entries", "stream=width,height,codec_type,nb_frames,duration",
      "-show_entries", "format=duration",
      "-of", "json",
      file,
    ], { shell: process.platform === "win32" && !process.env.FFPROBE_PATH });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.slice(-300)}`));
      try {
        const j = JSON.parse(out) as {
          streams?: Array<{ width?: number; height?: number; codec_type?: string; nb_frames?: string; duration?: string }>;
          format?: { duration?: string };
        };
        const v = (j.streams ?? []).find((s) => s.codec_type === "video");
        const hasAudio = (j.streams ?? []).some((s) => s.codec_type === "audio");
        resolve({
          width: Number(v?.width ?? 0),
          height: Number(v?.height ?? 0),
          duration: Number(j.format?.duration ?? 0),
          hasAudio,
          nbFrames: Number(v?.nb_frames ?? 0),
          videoStreamSec: Number(v?.duration ?? 0),
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

/** Resolves with ffmpeg's stderr on success — filters like silencedetect
 *  report their findings there on exit 0. */
function runFfmpeg(args: string[], timeoutMs = 5 * 60 * 1000, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (cwd) {
       const cmdStr = ["ffmpeg", ...args.map(a => `"${a}"`)].join(" ");
       fs.writeFileSync(path.join(cwd, "ffmpeg_debug.bat"), cmdStr);
    }
    const bin = process.env.FFMPEG_PATH || "ffmpeg";
    const child = spawn(bin, args, { cwd, shell: process.platform === "win32" && !process.env.FFMPEG_PATH });
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
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`));
    });
  });
}

// ─── Audio integrity (dead-air gate) ────────────────────────────────
// The frozen-reel incident bought us the video-integrity gate; the published
// dead-air reel (30008: silent 7.1s→22.0s) buys us this one. Deterministic:
// silencedetect on the ACTUAL render, refused when a long gap sits inside the
// timeline. Pure functions exported for tests.

export interface SilenceGap { start: number; end: number }

/** Parse ffmpeg silencedetect stderr into gaps. An unterminated
 *  silence_start (file ends silent) closes at durationSec. */
export function parseSilencedetect(stderr: string, durationSec: number): SilenceGap[] {
  const gaps: SilenceGap[] = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*([\d.]+)/);
    if (s) { open = Number(s[1]); continue; }
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && open !== null) { gaps.push({ start: open, end: Number(e[1]) }); open = null; }
  }
  if (open !== null) gaps.push({ start: open, end: durationSec });
  return gaps;
}

/**
 * Refuse renders with dead air. A gap counts when it is longer than
 * maxGapSec AND starts inside the timeline (the final 0.75s is tolerated —
 * natural tail-off into the freeze frame).
 */
export function evaluateAudioIntegrity(input: {
  gaps: SilenceGap[];
  durationSec: number;
  maxGapSec?: number;
}): { ok: boolean; reasons: string[] } {
  const maxGap = input.maxGapSec ?? 2.5;
  const reasons: string[] = [];
  for (const g of input.gaps) {
    const len = g.end - g.start;
    if (len >= maxGap && g.start < input.durationSec - 0.75) {
      reasons.push(
        `dead air: silent from ${g.start.toFixed(2)}s to ${g.end.toFixed(2)}s (${len.toFixed(1)}s of ${input.durationSec.toFixed(1)}s)`,
      );
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export interface AssembleResult {
  mp4Url: string;
  durationSec: number;
  usedVo: boolean;
  /** Each clip's shape as ffprobe read it here, by beat (provider attached by the pipeline; shared/clipDrift.ts). */
  clipProbes: Array<Omit<ClipProbe, "provider">>;
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
    const clipProbes: AssembleResult["clipProbes"] = [];
    for (let i = 0; i < segs.length; i++) {
      const p = path.join(workDir, `clip-${i}.mp4`);
      const url = clipUrls[i];
      // A `/generated/` url is NO LONGER a promise of a local file.
      //
      // It used to be: storagePut wrote to data/generated/ and Express served
      // that directory, so copying from disk was a free shortcut. Once object
      // storage landed, `/generated/` became a PROXY route that streams out of
      // S3 (storage.ts: publicObjectUrl + storageGetStream) — the bytes live in
      // the bucket and the container's disk is empty. The shortcut kept
      // assuming otherwise.
      //
      // Job 1200003 died on exactly this, having already PAID for four clips:
      //   ENOENT: copyfile '/app/apps/nickstire/data/generated/veo-…mp4'
      //           -> '/tmp/reel-1200003-…/clip-0.mp4'
      // Its Higgsfield clips (remote CloudFront urls) took the fetch branch and
      // were fine; only the proxied ones failed — which is why this looked like
      // a Veo problem and was not one.
      //
      // Existence is now CHECKED rather than assumed. A genuinely local file
      // (assets written before the store existed) still short-circuits; anything
      // else goes over HTTP, which is the path that already worked.
      // Resolve the FULL key after /generated/, not just the basename.
      // storagePut's local fallback used to flatten every key to its filename;
      // since it started preserving subdirectories (to stop distinct keys
      // colliding on one name), a basename lookup misses every nested file and
      // silently degrades to an HTTP round-trip against SITE_URL — which does
      // not resolve at all on a machine with no public hostname, breaking the
      // local no-S3 lane. Caught by pre-merge review 2026-08-21.
      const generatedRoot = path.join(process.cwd(), "data", "generated");
      const marker = "/generated/";
      const idx = url.indexOf(marker);
      const relKey = idx >= 0 ? decodeURIComponent(url.slice(idx + marker.length).split("?")[0]) : null;
      const candidate = relKey ? path.resolve(generatedRoot, relKey) : null;
      // Containment check: `url` is data, and a crafted one must not read
      // outside data/generated.
      const localPath =
        candidate && (candidate === generatedRoot || candidate.startsWith(generatedRoot + path.sep))
          ? candidate
          : null;
      if (localPath && fs.existsSync(localPath)) {
        await fs.promises.copyFile(localPath, p);
      } else {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`failed to fetch clip ${i} (HTTP ${resp.status}) from ${url.split("/").pop()}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length < 1024) throw new Error(`clip ${i} fetched only ${buf.length} bytes — refusing to assemble a truncated clip`);
        await fs.promises.writeFile(p, buf);
      }
      clipPaths.push(p);
      // PROVIDER DRIFT PROBE (2026-10-08, shared/clipDrift.ts). The bytes are
      // local now, so reading their shape costs nothing — no provider call, no
      // credit. A probe that fails is logged and left out; it never fails the
      // assembly, and a missing probe reads as "unmeasured", never as a match.
      try {
        const pr = await ffprobeReel(p);
        const fps = pr.nbFrames > 0 && pr.videoStreamSec > 0 ? Math.round(pr.nbFrames / pr.videoStreamSec) : null;
        clipProbes.push({ beatNumber: segs[i].beatNumber, width: pr.width, height: pr.height, fps, durationSec: Number(pr.duration.toFixed(2)) });
      } catch (e) {
        log.warn("clip probe failed (assembly continues)", { jobId, beat: segs[i].beatNumber, e: e instanceof Error ? e.message : String(e) });
      }
    }
    const { generateVoiceover, generateAssSubtitles } = await import("./reelVoice");
    const vo = await generateVoiceover(brief.voiceoverScript);
    let voPath: string | null = null;
    let assPath: string | null = null;
    if (vo) {
      voPath = path.join(workDir, `vo.${vo.ext}`);
      await fs.promises.writeFile(voPath, vo.buf);
      if (vo.alignment) {
        assPath = path.join(workDir, "captions.ass");
        await fs.promises.writeFile(assPath, generateAssSubtitles(vo.alignment));
      }
    }

    const outPath = path.join(workDir, "reel.mp4");
    const origFontPath = await resolveReelFontPath();
    const localFontPath = path.join(workDir, "font.ttf");
    await fs.promises.copyFile(origFontPath, localFontPath);

    // ONE declaration drives the files on disk AND what the filtergraph may
    // draw. Previously these were two independent places - a per-line write
    // loop, plus a `SAVE THIS | DM "<keyword>"` string concatenated here - and
    // nothing made them agree with the storyboard. That is how reel 1770003
    // shipped six burned-in cards from a five-beat payload.
    const ask = resolveReelAsk(brief);
    if (ask) {
      const askBad = askProblem(ask);
      // Fail the render rather than burn a malformed or compound ask into a
      // frame nobody can edit afterwards.
      if (askBad) throw new Error(`reel ask is invalid: ${askBad}`);
    }
    // The declared ask governs the END CARD. This catches a CTA that leaked
    // into a BEAT or the voiceover, which is a second, permanent ask — measured
    // on freshly generated briefs 2026-08-29, all three had one.
    const leak = askLeakageProblem({
      beats: (brief.storyboardBeats ?? []).map((b) => b.onScreenText),
      voiceoverScript: brief.voiceoverScript,
      caption: brief.selectedCaption,
      // Passing the resolved ask makes the check CROSS-SURFACE: a caption with
      // exactly one ask still fails when it is not the ask the end card renders.
      declaredAsk: ask,
    });
    if (leak) throw new Error(`refusing to render: ${leak}`);
    const askText = ask ? renderAskText(ask) : null;
    const surfaces = declaredTextSurfaces(segs, askText, !!assPath);
    for (const s of surfaces) {
      await fs.promises.writeFile(path.join(workDir, s.file), s.text, "utf-8");
    }

    const musicPath = pickMusicBed(brief);
    const args = buildFfmpegArgs({ segs, clipPaths, voPath, assPath, musicPath, fontPath: "font.ttf", outPath, askText });

    // The render must draw exactly what was declared - no more, no less. This
    // fires BEFORE ffmpeg runs, so an undeclared card costs a failed job rather
    // than a published frame that no payload review would ever surface.
    const undeclared = undeclaredTextProblem(args, surfaces, !!brief.voiceoverScript);
    if (undeclared) {
      throw new Error(`refusing to render: ${undeclared}`);
    }
    log.info("assembling reel", { jobId, beats: segs.length, total, usedVo: !!voPath, usedAss: !!assPath, usedMusic: !!musicPath });
    await runFfmpeg(args, 5 * 60 * 1000, workDir);

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

    // Motion + frame-count forensics: sample frames across the timeline and
    // require the render to actually move. This is the gate the frozen-reel
    // incident proved we needed — dimensions/duration/audio all passed while
    // the video stream held one image.
    const expectedSec = total + SAVE_FREEZE_SECONDS;
    const sampleTimes = [0.2, 0.35, 0.5, 0.65, 0.8].map((f) => Number((expectedSec * f).toFixed(2)));
    const frameHashes: string[] = [];
    for (const t of sampleTimes) {
      frameHashes.push(await hashFrameAt(outPath, t, workDir));
    }
    const integrity = evaluateRenderIntegrity({
      durationSec: probe.duration,
      videoStreamSec: probe.videoStreamSec,
      nbFrames: probe.nbFrames,
      expectedSec,
      frameHashes,
    });
    if (!integrity.ok) {
      throw new Error(`render integrity failed: ${integrity.reasons.join("; ")}`);
    }
    log.info("render integrity verified", { jobId, durationSec: probe.duration, nbFrames: probe.nbFrames, distinctFrames: new Set(frameHashes).size });

    // Dead-air gate: measure the ACTUAL rendered audio. The published reel
    // 30008 shipped 68% silent because the graph truncated music at VO-end —
    // a defect no string-level test could see. Deterministic and cheap
    // (~1s): silencedetect over the final file, refuse long in-timeline gaps.
    if (voPath || musicPath) {
      const silenceStderr = await runFfmpeg(
        ["-i", outPath, "-af", "silencedetect=n=-35dB:d=1.0", "-f", "null", "-"],
        60 * 1000,
        workDir,
      );
      const gaps = parseSilencedetect(silenceStderr, probe.duration);
      const audio = evaluateAudioIntegrity({ gaps, durationSec: probe.duration });
      if (!audio.ok) {
        throw new Error(`audio integrity failed: ${audio.reasons.join("; ")}`);
      }
      log.info("audio integrity verified", { jobId, silentGaps: gaps.length });

      // Full audio QA (milestone 8): loudness, true peak, clipping, channels.
      // Best-effort EVIDENCE, not a hard block — the dead-air gate above is
      // the render-integrity guard; a loudness/peak finding is a repair signal
      // for the approve gate, logged loudly, never a silent pass.
      // The verdict is PERSISTED, not just logged. It used to be computed here and
      // thrown away, so payload.audioQa never existed on any row — which meant the
      // publish gate's audio check could never be satisfied by any job. Evidence
      // that only reaches the log cannot gate anything.
      let audioQa: Record<string, unknown>;
      try {
        const { runAudioQa } = await import("./audioQa");
        const aqa = await runAudioQa(outPath);
        if (aqa.decision === "repair") log.warn("audio QA flagged findings (evidence for approve gate)", { jobId, findings: aqa.findings, lufs: aqa.integratedLufs, tp: aqa.truePeakDb, ch: aqa.channels });
        else log.info("audio QA passed", { jobId, lufs: aqa.integratedLufs, tp: aqa.truePeakDb, ch: aqa.channels });
        audioQa = { ...aqa, qaState: "completed", evaluatedAt: new Date().toISOString() };
      } catch (e) {
        // An audio QA that could not RUN is recorded as unavailable — never as a
        // pass. The gate distinguishes the two; a missing key would read as
        // "never evaluated" and hold, which is the same safe direction but gives
        // the operator no reason.
        log.warn("audio QA hook failed (render unaffected)", { jobId, e: e instanceof Error ? e.message : String(e) });
        audioQa = { decision: "approve", qaState: "unavailable", error: e instanceof Error ? e.message.slice(0, 200) : String(e), evaluatedAt: new Date().toISOString() };
      }
      try {
        const { db } = await import("../lib/db-helper");
        const d = await db();
        if (d) {
          const { reelJobs } = await import("../../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          const numericJobId = Number(jobId);
          if (Number.isInteger(numericJobId)) {
            const [row] = await d.select().from(reelJobs).where(eq(reelJobs.id, numericJobId)).limit(1);
            if (row) {
              const payload = JSON.parse(row.payload ?? "{}");
              payload.audioQa = audioQa;
              await d.update(reelJobs).set({ payload: JSON.stringify(payload) }).where(eq(reelJobs.id, numericJobId));
            }
          }
        }
      } catch (e) {
        log.warn("could not persist audio QA verdict — publish gate will treat audio as unevaluated", { jobId, e: e instanceof Error ? e.message : String(e) });
      }
    }

    const mp4 = await fs.promises.readFile(outPath);
    const { storagePut } = await import("../storage");
    // Unique basename per job: the no-S3 fallback serves by basename only
    // (storagePut does path.basename), so a constant "reel.mp4" would make every
    // job overwrite the same data/generated/reel.mp4. reel-<jobId>.mp4 keeps them distinct.
    const put = await storagePut(`reels/reel-${jobId}.mp4`, mp4, "video/mp4");
    log.info("reel assembled", { jobId, bytes: mp4.length, url: put.url });
    // Canonical registry entry for the master (checksum, lineage, permanence
    // truth). Tolerant seam — bookkeeping failure never fails the render.
    try {
      const { getDb } = await import("../db");
      const { registerProducedAsset } = await import("./mediaRegistry");
      const d = await getDb();
      if (d) {
        const registered = await registerProducedAsset(d, mp4, {
          logicalKey: `reel:${jobId}:master`,
          assetType: "draft_render",
          format: "video",
          mimeType: "video/mp4",
          campaignId: String(jobId),
          provider: "ffmpeg-assembly",
          runtimeUrl: put.url,
          generationParams: { durationSec: total + SAVE_FREEZE_SECONDS, usedVo: !!voPath },
        });
        // AUTO-ARCHIVAL (vault's remaining leg, gated assessment): until now
        // archiveRegisteredAsset had no production caller — masters reached
        // Drive only by hand. Every registered master now vaults itself:
        // campaign workspace ensured, byte-verified upload, registry flipped
        // to synced only on size match. Best-effort — archival failure logs
        // LOUDLY (reconciliation surfaces the pending backlog) but never
        // fails the render.
        if (registered) {
          try {
            const { vaultConfigured, ensureCampaignWorkspace, archiveRegisteredAsset } = await import("./creativeVault");
            if (await vaultConfigured(d)) {
              const ws = await ensureCampaignWorkspace(d, { campaignId: `reel-${jobId}`, name: `Reel ${jobId}` });
              const arch = await archiveRegisteredAsset(d, registered.id, { folderId: ws.folderId, bytes: mp4 });
              if (arch.ok) log.info("master auto-archived to vault", { jobId, assetId: registered.id, fileId: arch.fileId });
              else log.error("master auto-archival FAILED — registry keeps it pending, reconcile will surface it", { jobId, assetId: registered.id, reason: arch.reason });
            }
          } catch (e) {
            log.error("auto-archival hook failed (render unaffected)", { jobId, e: e instanceof Error ? e.message : String(e) });
          }
        }
      }
    } catch { /* registerProducedAsset is already tolerant; belt over suspenders */ }
    // Report the REAL file length (beats + the save-payload freeze), not just the beats.
    return { mp4Url: put.url, durationSec: total + SAVE_FREEZE_SECONDS, usedVo: !!voPath, clipProbes };
  } finally {
    fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
