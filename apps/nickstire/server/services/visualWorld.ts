/**
 * Reel Visual World — the first visual-production layer (scorecard priority 1).
 *
 * Problem it attacks: every beat is an independent Seedance call, so the hero
 * object's shape, damage, environment, and lighting drift between shots — the
 * "several AI clips assembled together" look. This slice generates THREE 9:16
 * reference-frame candidates (safe / bold / experimental takes on the brief's
 * hero + motion lens), the operator approves ONE, and its compiled invariants
 * replace the generic continuity block in EVERY beat prompt.
 *
 * Honest scope: seedance1_5's schema was NOT probed for an input-image
 * parameter (probing rotates the prod CLI session — the trap that broke reel
 * generation once already), so this slice conditions through TEXT invariants
 * compiled from the approved frame's exact prompt. If/when image conditioning
 * is verified, the approved frame URL is already persisted on the brief.
 */
import {
  MOTION_LENSES,
  OBJECT_CHARACTERS,
  VISUAL_WORLD_STYLES,
  type ReelBrief,
  type ReelVisualWorld,
  type VisualWorldStyle,
} from "../../client/src/lib/facelessReelStudio";
import { createLogger } from "../lib/logger";

const log = createLogger("services:visual-world");

/** What each candidate style asks the image model for — three genuinely
 *  different takes so the operator makes a real creative choice. */
export const STYLE_DIRECTIVES: Record<VisualWorldStyle, string> = {
  safe: "Clean, credible product-documentary realism. Even studio-adjacent lighting, honest materials, nothing exaggerated — the frame a trustworthy shop would publish.",
  bold: "Dramatic cinematic contrast: hard key light, deep graphite shadows, gold rim-light accents, low decisive camera angle. The frame feels like a film still, not a catalog photo.",
  experimental: "Push the motion lens to its extreme interpretation. Unexpected composition, scale play, or environment twist while keeping the hero object physically credible.",
};

export type VisualWorldBriefInput = Pick<
  ReelBrief,
  "topic" | "objectCharacter" | "motionLens" | "storyboardBeats"
>;

/** Deterministic 9:16 reference-frame prompt per style. */
export function buildReferenceFramePrompt(brief: VisualWorldBriefInput, style: VisualWorldStyle): string {
  const character = OBJECT_CHARACTERS[brief.objectCharacter];
  const lens = MOTION_LENSES[brief.motionLens];
  const heroAnchor = brief.storyboardBeats[0]?.visual.trim() || character.essence;
  return [
    `Single 9:16 vertical hero frame establishing the visual world of a short automotive film.`,
    `Hero subject: ${character.label} — ${character.essence} Established as: ${heroAnchor}`,
    `Visual grammar: ${lens.grammar}`,
    `Style: ${STYLE_DIRECTIVES[style]}`,
    `Palette: graphite black and deep shadow tones with gold #FDB913 accent highlights.`,
    `Composition: hero object dominant, clear silhouette, generous headroom and footroom kept clean for caption overlays.`,
    `DO NOT INCLUDE: ${lens.avoid}, humans, faces, hands, text, lettering, logos, watermarks.`,
  ].join(" ");
}

/** The invariant block every beat prompt carries once a frame is approved.
 *  Compiled from the EXACT prompt that produced the approved frame, so the
 *  lock describes what the operator actually saw and chose. */
export function compileLockedInvariants(brief: VisualWorldBriefInput, style: VisualWorldStyle, framePrompt: string): string {
  const character = OBJECT_CHARACTERS[brief.objectCharacter];
  return [
    `VISUAL WORLD (operator-approved reference frame — match it EXACTLY in every shot):`,
    `The approved hero frame was generated from: "${framePrompt}"`,
    `Every shot shows the SAME ${character.label.toLowerCase()} — same geometry, same surface/tread pattern, same damage in the same location, same environment, same lighting direction, same ${style} styling, same graphite-and-gold #FDB913 palette.`,
    `Never introduce a different vehicle, wheel design, environment, weather, or color grade between shots.`,
  ].join("\n");
}

export interface ReferenceFrameCandidate {
  style: VisualWorldStyle;
  url: string;
  framePrompt: string;
  lockedInvariants: string;
}

/**
 * Generate the three candidates (uses image credits — 3 calls). Candidates
 * that fail generation are dropped with a warning rather than failing the
 * whole set; zero successes throws so the UI fails loud.
 */
export async function generateReferenceFrames(brief: VisualWorldBriefInput): Promise<ReferenceFrameCandidate[]> {
  const { generateCarouselSlideImage } = await import("./higgsfieldStudio");
  const results = await Promise.allSettled(
    VISUAL_WORLD_STYLES.map(async (style) => {
      const framePrompt = buildReferenceFramePrompt(brief, style);
      const url = await generateCarouselSlideImage({ prompt: framePrompt, aspectRatio: "9:16" });
      return {
        style,
        url,
        framePrompt,
        lockedInvariants: compileLockedInvariants(brief, style, framePrompt),
      } satisfies ReferenceFrameCandidate;
    }),
  );
  const frames = results.filter((r): r is PromiseFulfilledResult<ReferenceFrameCandidate> => r.status === "fulfilled").map((r) => r.value);
  const failures = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  for (const f of failures) {
    log.warn("reference frame candidate failed", { err: f.reason instanceof Error ? f.reason.message.slice(0, 160) : String(f.reason) });
  }
  if (frames.length === 0) {
    throw new Error(`All reference-frame candidates failed: ${failures[0]?.reason instanceof Error ? failures[0].reason.message : "unknown"}`);
  }
  log.info("reference frames generated", { requested: VISUAL_WORLD_STYLES.length, succeeded: frames.length });
  return frames;
}

/** Assemble the persisted visual world from the operator's chosen candidate. */
export function visualWorldFromCandidate(candidate: ReferenceFrameCandidate): ReelVisualWorld {
  return {
    style: candidate.style,
    heroFrameUrl: candidate.url,
    framePrompt: candidate.framePrompt,
    lockedInvariants: candidate.lockedInvariants,
  };
}
