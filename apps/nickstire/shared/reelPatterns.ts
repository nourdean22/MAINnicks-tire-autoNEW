/**
 * Pattern Lab (Wave C′ final item): the STRUCTURE of a winning short-form
 * reference — hook mechanics, pacing, caption hierarchy, loop type — captured
 * as data, never the content itself.
 *
 * Operating rules (accepted design, 2026-07-29 CGD):
 *  - No scraping, no downloads, no reposts. `sourceUrl`/`sourceLabel` are a
 *    citation for the operator's memory, never an asset to fetch.
 *  - What gets copied is the pattern; what never gets copied is the creator's
 *    visuals, phrasing, branded style, or audio (Meta recommendation systems
 *    penalize non-original content; originality is also just the brand).
 *  - The transformer feeds the EXISTING Create machinery via the handoff
 *    contract — a pattern is a structured brief for the generator we already
 *    trust, not a second generator.
 */

export const PATTERN_HOOK_TYPES = [
  "impossible_object",
  "visual_contradiction",
  "satisfying_macro",
  "myth_vs_reality",
  "countdown",
  "tiny_story",
  "warning_alert",
  "forensic_scan",
] as const;
export type PatternHookType = typeof PATTERN_HOOK_TYPES[number];

export const PATTERN_LOOP_TYPES = [
  "cause_loop",
  "object_loop",
  "question_loop",
  "motion_loop",
  "problem_loop",
  "other",
] as const;
export type PatternLoopType = typeof PATTERN_LOOP_TYPES[number];

export const PATTERN_CAPTION_HIERARCHIES = [
  "headline_only",
  "headline_subline",
  "subtitle",
  "kinetic",
] as const;
export type PatternCaptionHierarchy = typeof PATTERN_CAPTION_HIERARCHIES[number];

export interface ReelPattern {
  id: string;
  /** Short human name, e.g. "Pothole gremlin cause-loop". */
  label: string;
  /** Where the operator saw it — citation text, not an asset reference. */
  sourceLabel?: string;
  /** Optional reference URL. NEVER fetched or scraped by the system. */
  sourceUrl?: string;
  hookType: PatternHookType;
  pacing: {
    totalSeconds: number;
    beatCount: number;
    avgShotLength: number;
    firstTextAtSecond: number;
  };
  visualStyle: {
    lens: string;
    lighting: string;
    color: string;
    motion: string;
    texture: string;
  };
  captionStyle: {
    wordsPerBeat: number;
    placement: string;
    hierarchy: PatternCaptionHierarchy;
  };
  audioStyle: {
    musicMood: string;
    voiceover: boolean;
    sfx: string[];
  };
  loopType: PatternLoopType;
  /** Who sends this to whom — the reason it spreads. */
  shareTrigger: string;
  /** What makes someone keep it — the reason it gets saved. */
  saveTrigger: string;
  /** REQUIRED: the Nick's-truth version of the idea. A pattern without an
   *  adaptation is a bookmark, not a plan. */
  nickAdaptation: string;
}

/** The permanent DO-NOT-COPY list — displayed beside every pattern, not stored per row. */
export const PATTERN_DO_NOT_COPY = [
  "the creator's exact visuals or footage",
  "their phrasing or captions",
  "their branded style or identity",
  "their audio (copyright + originality)",
] as const;

/**
 * Pattern → Create-handoff directive. HARD BUDGET: writeCreateHandoff slices
 * detail at 800 chars, so this composes to fit — nickAdaptation gets priority,
 * style fields truncate first, and the no-copy rule always survives.
 */
export function formatPatternAdaptation(p: ReelPattern): string {
  const t = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const lines = [
    `PATTERN "${t(p.label, 60)}" — hook: ${p.hookType} · loop: ${p.loopType}`,
    `Pacing: ${p.pacing.totalSeconds}s, ${p.pacing.beatCount} beats, ~${p.pacing.avgShotLength}s/shot, first text @${p.pacing.firstTextAtSecond}s`,
    `Visual world: ${t(p.visualStyle.lens, 40)}, ${t(p.visualStyle.lighting, 40)}, ${t(p.visualStyle.color, 40)}, ${t(p.visualStyle.motion, 40)}`,
    `Captions: ≤${p.captionStyle.wordsPerBeat} words/beat, ${t(p.captionStyle.placement, 40)}, ${p.captionStyle.hierarchy}`,
    `Audio: ${t(p.audioStyle.musicMood, 40)}, VO ${p.audioStyle.voiceover ? "yes" : "no"}${p.audioStyle.sfx.length ? `, sfx: ${t(p.audioStyle.sfx.join("/"), 40)}` : ""}`,
    `Share trigger: ${t(p.shareTrigger, 90)}`,
    `Save trigger: ${t(p.saveTrigger, 90)}`,
    `NICK VERSION: ${t(p.nickAdaptation, 260)}`,
    `Copy the STRUCTURE only — never the reference's visuals, phrasing, style, or audio.`,
  ];
  return lines.join("\n").slice(0, 800);
}
