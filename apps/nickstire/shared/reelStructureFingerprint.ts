/**
 * Reel production-grammar fingerprint.
 *
 * Creative novelty and production novelty are different. A reel can teach a
 * completely new mechanic truth while still looking like the same reel again:
 * same duration, same five beats, same macro -> lateral -> comparison -> reveal
 * sequence, same click cues, same CTA. This module makes that repetition
 * inspectable without inventing a "viral score".
 */

export interface StructureBeat {
  startSecond?: number;
  endSecond?: number;
  visual?: string;
  motion?: string;
  purpose?: string;
  audioCue?: string;
  onScreenText?: string;
}

export interface ReelStructureFingerprint {
  durationBucket: "micro" | "short" | "classic" | "long";
  beatCount: number;
  visualFamilies: string[];
  motionFamilies: string[];
  audioFamilies: string[];
  purposeFamilies: string[];
  ctaType: string;
  loopType: string;
  signature: string;
}

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function durationBucket(seconds: number): ReelStructureFingerprint["durationBucket"] {
  if (seconds <= 9) return "micro";
  if (seconds <= 15) return "short";
  if (seconds <= 24) return "classic";
  return "long";
}

function family(text: string, rules: ReadonlyArray<readonly [string, RegExp]>, fallback = "other"): string {
  const s = clean(text);
  for (const [name, re] of rules) if (re.test(s)) return name;
  return fallback;
}

const VISUAL_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["macro", /\b(macro|close[- ]?up|extreme close|detail shot)\b/i],
  ["comparison", /\b(split|side[- ]?by[- ]?side|comparison|versus|\bvs\b|before.?after)\b/i],
  ["diagram", /\b(diagram|cross[- ]?section|exploded|cutaway|x[- ]?ray|technical graphic)\b/i],
  ["undercar", /\b(undercar|underbody|under car|beneath the vehicle|chassis)\b/i],
  ["instrument", /\b(gauge|scanner|meter|tester|screen|dashboard|display)\b/i],
  ["hands_tools", /\b(hand|hands|tool|wrench|socket|probe|flashlight|gauge)\b/i],
  ["tire_wheel", /\b(tire|tyre|wheel|rim|tread|sidewall)\b/i],
  ["shop_context", /\b(shop|bay|lift|vehicle|car|wide shot|wide angle|garage)\b/i],
];

const MOTION_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["push", /\b(push|dolly in|move in|creep in)\b/i],
  ["pull", /\b(pull|dolly out|move out)\b/i],
  ["lateral", /\b(lateral|slide|sideways|truck left|truck right)\b/i],
  ["orbit", /\b(orbit|arc|circle)\b/i],
  ["pan_tilt", /\b(pan|tilt)\b/i],
  ["zoom", /\bzoom\b/i],
  ["rack_focus", /\b(rack focus|focus pull)\b/i],
  ["handheld", /\b(handheld|hand-held)\b/i],
  ["static", /\b(static|locked|still|no movement)\b/i],
];

const AUDIO_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["click", /\b(click|snap|tick)\b/i],
  ["impact", /\b(impact|clunk|thud|slam)\b/i],
  ["whoosh", /\b(whoosh|swoosh|swish)\b/i],
  ["ambience", /\b(ambience|ambient|shop sound|room tone)\b/i],
  ["mechanical", /\b(ratchet|wrench|air tool|compressor|mechanical)\b/i],
  ["silence", /\b(silence|silent|none|no audio)\b/i],
];

const PURPOSE_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["hook", /\b(hook|open|cold open|attention|mystery)\b/i],
  ["identify", /\b(identify|symptom|problem|setup|context)\b/i],
  ["compare", /\b(compare|comparison|versus|difference)\b/i],
  ["explain", /\b(explain|mechanism|why|teach|proof)\b/i],
  ["reveal", /\b(reveal|payoff|show|answer)\b/i],
  ["cta", /\b(cta|call to action|visit|save|share|send|book|call)\b/i],
  ["loop", /\b(loop|return|repeat)\b/i],
];

function normalizedPurpose(beat: StructureBeat, index: number, count: number): string {
  const explicit = family(beat.purpose ?? "", PURPOSE_RULES, "");
  if (explicit) return explicit;
  if (index === 0) return "hook";
  if (index === count - 1) return "payoff_end";
  return "body";
}

export function reelStructureFingerprint(input: {
  beats: StructureBeat[];
  ctaType?: string | null;
  loopIdea?: string | null;
}): ReelStructureFingerprint {
  const beats = input.beats ?? [];
  const lastEnd = beats.reduce((max, b) => Math.max(max, Number(b.endSecond) || 0), 0);
  const inferredDuration = lastEnd || beats.reduce((sum, b) => {
    const start = Number(b.startSecond) || 0;
    const end = Number(b.endSecond) || start;
    return sum + Math.max(0, end - start);
  }, 0);

  const visualFamilies = beats.map((b) => family(b.visual ?? "", VISUAL_RULES));
  const motionFamilies = beats.map((b) => family(b.motion ?? "", MOTION_RULES));
  const audioFamilies = beats.map((b) => family(b.audioCue ?? "", AUDIO_RULES));
  const purposeFamilies = beats.map((b, i) => normalizedPurpose(b, i, beats.length));
  const loopType = clean(input.loopIdea)
    ? family(input.loopIdea ?? "", [["return", /\b(return|back to|opening|first frame)\b/i], ["seamless", /\b(seamless|match cut|continuous)\b/i]], "declared")
    : "none";
  const ctaType = clean(input.ctaType) || "none";
  const core = {
    durationBucket: durationBucket(inferredDuration),
    beatCount: beats.length,
    visualFamilies,
    motionFamilies,
    audioFamilies,
    purposeFamilies,
    ctaType,
    loopType,
  };
  return { ...core, signature: JSON.stringify(core) };
}

function positionalSimilarity(a: string[], b: string[]): number {
  const n = Math.max(a.length, b.length);
  if (!n) return 1;
  let same = 0;
  for (let i = 0; i < n; i += 1) if (a[i] === b[i]) same += 1;
  return same / n;
}

export interface ReelStructureNoveltyVerdict {
  similarity: number;
  isProductionTwin: boolean;
  collisions: string[];
  nearest?: ReelStructureFingerprint;
}

function compareReelStructures(
  candidate: ReelStructureFingerprint,
  prior: ReelStructureFingerprint,
): ReelStructureNoveltyVerdict {
  const collisions: string[] = [];
  let score = 0;

  if (candidate.durationBucket === prior.durationBucket) {
    score += 0.1;
    collisions.push("duration");
  }
  if (candidate.beatCount === prior.beatCount) {
    score += 0.15;
    collisions.push("beat_count");
  }

  const visual = positionalSimilarity(candidate.visualFamilies, prior.visualFamilies);
  const motion = positionalSimilarity(candidate.motionFamilies, prior.motionFamilies);
  const audio = positionalSimilarity(candidate.audioFamilies, prior.audioFamilies);
  const purpose = positionalSimilarity(candidate.purposeFamilies, prior.purposeFamilies);

  score += visual * 0.3;
  score += motion * 0.2;
  score += audio * 0.1;
  score += purpose * 0.1;

  if (visual >= 0.8) collisions.push("visual_sequence");
  if (motion >= 0.8) collisions.push("motion_sequence");
  if (audio >= 0.8) collisions.push("audio_sequence");
  if (purpose >= 0.8) collisions.push("beat_roles");
  if (candidate.ctaType !== "none" && candidate.ctaType === prior.ctaType) {
    score += 0.025;
    collisions.push("cta");
  }
  if (candidate.loopType !== "none" && candidate.loopType === prior.loopType) {
    score += 0.025;
    collisions.push("loop");
  }

  const similarity = Math.round(Math.min(1, score) * 100) / 100;
  return { similarity, isProductionTwin: similarity >= 0.82, collisions, nearest: prior };
}

export function assessReelStructureNovelty(
  candidate: ReelStructureFingerprint,
  priors: ReelStructureFingerprint[],
): ReelStructureNoveltyVerdict {
  let best: ReelStructureNoveltyVerdict = { similarity: 0, isProductionTwin: false, collisions: [] };
  for (const prior of priors) {
    const verdict = compareReelStructures(candidate, prior);
    if (verdict.similarity > best.similarity) best = verdict;
  }
  return best;
}
