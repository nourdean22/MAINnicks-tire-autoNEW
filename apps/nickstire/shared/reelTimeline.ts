/**
 * An EDITORIAL TIMELINE, not a list of clips.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The pipeline's current model is one beat = one clip = one caption = one
 * sentence, concatenated. That single fact is what makes automated video feel
 * automated, and no amount of prompt quality fixes it: when every sentence ends
 * exactly where a shot ends, the viewer's ear and eye are cut at the same
 * instant, every time, for twenty seconds. Human editors almost never do that.
 * They overlap. The audio of the next thought starts under the tail of the
 * current picture (a J-cut), or the current speech runs past the cut into the
 * next image (an L-cut). That overlap is most of what "professionally edited"
 * actually means.
 *
 * This module makes picture and audio INDEPENDENT OBJECTS on separate tracks,
 * so an overlap is expressible at all. Until they were the same object it was
 * not possible to author one.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 * Nothing about what a reel should SAY. Story content, franchises, claim
 * verification and originality live elsewhere and are owned elsewhere. This
 * file knows only about time, tracks and craft.
 */

/** Every layer that can occupy time. Five audio buses plus picture and overlays. */
export type TrackKind =
  | "picture"
  | "dialogue"
  | "music"
  | "foley"
  | "sfx"
  | "ambience"
  | "graphics"
  | "captions";

/** The five buses that get mixed. Ordered loudest-intent first. */
export const AUDIO_BUSES = ["dialogue", "music", "foley", "sfx", "ambience"] as const;
export type AudioBus = (typeof AUDIO_BUSES)[number];

/**
 * What a beat is DOING, not what it shows. Recorded because the music and the
 * silence need to know where the reveal is, and "beat 4" does not tell them.
 */
export type StoryFunction = "hook" | "problem" | "evidence" | "turn" | "resolution" | "ask";

/** Reveal beats: where a drop or a held silence belongs. */
export const REVEAL_FUNCTIONS: readonly StoryFunction[] = ["turn", "resolution"];

export type ShotScale = "extreme_close" | "close" | "medium" | "wide";
export type MotionDirection = "push_in" | "pull_back" | "lateral" | "static" | "rotate";

/** One picture segment. Its boundaries are PICTURE boundaries only. */
export interface PictureBeat {
  id: string;
  storyFunction: StoryFunction;
  shotScale: ShotScale;
  motion: MotionDirection;
  startSec: number;
  endSec: number;
}

/**
 * One audio element. `beatId` is the beat it belongs to NARRATIVELY; its own
 * start/end are free to precede or outlast that beat's picture, which is
 * exactly what a J-cut or an L-cut is.
 */
export interface AudioClip {
  id: string;
  bus: AudioBus;
  startSec: number;
  endSec: number;
  /** The picture beat this audio serves. Optional for beds like ambience. */
  beatId?: string;
}

export type MusicSectionKind = "intro" | "build" | "drop" | "sustain" | "outro";

/** A musical section with a real boundary, so a drop can be placed on purpose. */
export interface MusicSection {
  kind: MusicSectionKind;
  startSec: number;
  endSec: number;
}

/**
 * Silence as a COMPOSED EVENT rather than the absence of a decision. A held
 * beat before a reveal is the cheapest dramatic tool available and it cannot be
 * produced by a mixer that is always playing something.
 */
export interface SilenceEvent {
  startSec: number;
  endSec: number;
  purpose: "pre_reveal" | "breath" | "post_punchline";
}

export interface GraphicEvent {
  id: string;
  startSec: number;
  endSec: number;
  kind: "caption" | "lower_third" | "end_card";
}

export interface ReelTimeline {
  durationSec: number;
  picture: PictureBeat[];
  audio: AudioClip[];
  music: MusicSection[];
  silence: SilenceEvent[];
  graphics: GraphicEvent[];
}

const EPS = 0.001;
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;

/* ── structural validity ─────────────────────────────────────────────────── */

/**
 * Why this timeline is not renderable, or null when it is sound.
 *
 * Picture must TILE the duration: gaps render black and overlaps are
 * ambiguous. Audio deliberately may not tile - silence is legal and modelled.
 */
export function timelineProblem(t: ReelTimeline): string | null {
  if (!(t.durationSec > 0)) return "timeline has no duration";
  if (!t.picture.length) return "timeline has no picture beats";

  for (const b of t.picture) {
    if (b.endSec - b.startSec <= EPS) return `picture beat ${b.id} has zero or negative duration`;
  }
  for (const c of t.audio) {
    if (c.endSec - c.startSec <= EPS) return `audio clip ${c.id} has zero or negative duration`;
    if (c.startSec < -EPS) return `audio clip ${c.id} starts before the timeline`;
    if (c.endSec > t.durationSec + EPS) return `audio clip ${c.id} runs past the end of the timeline`;
  }

  const ordered = [...t.picture].sort((a, b) => a.startSec - b.startSec);
  if (Math.abs(ordered[0].startSec) > EPS) return "picture does not start at 0";
  for (let i = 1; i < ordered.length; i++) {
    const gap = ordered[i].startSec - ordered[i - 1].endSec;
    if (Math.abs(gap) > EPS) {
      return gap > 0
        ? `picture gap of ${gap.toFixed(2)}s before beat ${ordered[i].id} would render black`
        : `picture beats ${ordered[i - 1].id} and ${ordered[i].id} overlap by ${(-gap).toFixed(2)}s`;
    }
  }
  const last = ordered[ordered.length - 1];
  if (!near(last.endSec, t.durationSec, 0.05)) {
    return `picture ends at ${last.endSec.toFixed(2)}s but the timeline is ${t.durationSec.toFixed(2)}s`;
  }

  const beatIds = new Set(t.picture.map((b) => b.id));
  for (const c of t.audio) {
    if (c.beatId && !beatIds.has(c.beatId)) return `audio clip ${c.id} references unknown beat ${c.beatId}`;
  }
  return null;
}

/* ── the craft rule: audio and picture must not cut together ─────────────── */

export interface CutOverlap {
  clipId: string;
  beatId: string;
  /** Seconds the audio leads its beat's picture (J-cut). */
  leadSec: number;
  /** Seconds the audio outlasts its beat's picture (L-cut). */
  lagSec: number;
}

/** How each dialogue clip sits against its beat's picture boundaries. */
export function cutOverlaps(t: ReelTimeline): CutOverlap[] {
  const byId = new Map(t.picture.map((b) => [b.id, b]));
  return t.audio
    .filter((c) => c.bus === "dialogue" && c.beatId && byId.has(c.beatId))
    .map((c) => {
      const b = byId.get(c.beatId!)!;
      return {
        clipId: c.id,
        beatId: b.id,
        leadSec: Number((b.startSec - c.startSec).toFixed(3)),
        lagSec: Number((c.endSec - b.endSec).toFixed(3)),
      };
    });
}

/** Minimum overlap that reads as intentional rather than a rounding artifact. */
export const MIN_MEANINGFUL_OVERLAP_SEC = 0.15;

/**
 * Why this timeline still has machine cadence, or null when it breathes.
 *
 * THE TEST IS NOT "does one overlap exist" - it is whether the edit is
 * SYSTEMATICALLY locked. A timeline where every dialogue clip starts and ends
 * exactly on its picture cut is the concatenated shape this module exists to
 * replace, however good the individual clips are.
 *
 * Single-beat timelines are exempt: there is no cut to straddle.
 */
export function machineCadenceProblem(t: ReelTimeline): string | null {
  if (t.picture.length < 2) return null;
  const overlaps = cutOverlaps(t);
  if (!overlaps.length) return "no dialogue is attached to any picture beat, so no cut can be straddled";

  const straddling = overlaps.filter(
    (o) => o.leadSec >= MIN_MEANINGFUL_OVERLAP_SEC || o.lagSec >= MIN_MEANINGFUL_OVERLAP_SEC,
  );
  if (straddling.length === 0) {
    return (
      `every dialogue clip begins and ends on its own picture cut (${overlaps.length} of ${overlaps.length}). ` +
      "That is sentence-one-gets-clip-one — the cadence that makes automated video sound automated. " +
      "At least one J-cut (audio leads the picture) or L-cut (audio outlasts it) is required."
    );
  }
  return null;
}

/* ── music has to know where the reveal is ───────────────────────────────── */

/**
 * Why the music is not scored to the story, or null when it is.
 *
 * A track played from zero puts its drop wherever the track happens to drop.
 * Scoring means the drop lands on a beat that reveals something.
 */
export function musicAlignmentProblem(t: ReelTimeline): string | null {
  const drop = t.music.find((m) => m.kind === "drop");
  if (!drop) return null; // a reel with no drop is a legitimate choice
  const reveals = t.picture.filter((b) => REVEAL_FUNCTIONS.includes(b.storyFunction));
  if (!reveals.length) return "the music has a drop but no beat is marked as a reveal (turn/resolution)";
  const aligned = reveals.some((b) => near(drop.startSec, b.startSec, 0.25));
  if (!aligned) {
    return (
      `the music drop at ${drop.startSec.toFixed(2)}s does not land on a reveal ` +
      `(reveals at ${reveals.map((b) => b.startSec.toFixed(2)).join(", ")}s). ` +
      "A drop that lands on nothing is a track playing from zero."
    );
  }
  return null;
}

/** Total seconds of composed silence. Zero is legal; it is the signal that none was authored. */
export function silenceBudgetSec(t: ReelTimeline): number {
  return Number(t.silence.reduce((s, e) => s + Math.max(0, e.endSec - e.startSec), 0).toFixed(3));
}
