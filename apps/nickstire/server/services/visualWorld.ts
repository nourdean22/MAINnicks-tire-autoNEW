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
    // POSITIVE clean-scene phrasing, not a "DO NOT INCLUDE" list: this prompt
    // goes to the image generator AND is quoted verbatim into every beat's
    // Seedance prompt, so naming text/logos/watermarks in a negation here
    // re-introduces the exact pink-elephant trigger PR #855 removed from the
    // beat negative (it produced the "Nixs" logo + garbled readouts in reel
    // 690001). Only the style-breakers stay as an avoid note (not concept tokens).
    `Unpopulated and unbranded scene: the object stands alone — no people, faces, hands, or gloves; every surface clean with no signage, logos, lettering, words, or numbers anywhere in frame; any screen or gauge dark, off, or angled away from camera.`,
    `Keep the look free of ${lens.avoid}.`,
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
export async function generateReferenceFrames(
  brief: VisualWorldBriefInput,
  styles: readonly VisualWorldStyle[] = VISUAL_WORLD_STYLES,
): Promise<ReferenceFrameCandidate[]> {
  const { generateCarouselSlideImage } = await import("./higgsfieldStudio");
  // Ledger: reserve the image spend up front (one call per requested style),
  // settle with the actual success count after. Per-invocation action id —
  // frame batches are not retried under one identity, so idempotency is per batch.
  const { reserve, settle, release, COST_ESTIMATES_USD } = await import("./generationLedger");
  const { getActivePolicy } = await import("./autonomyControl");
  const actionId = `ref_frames_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const policy = await getActivePolicy();
  await reserve({
    actionId,
    provider: "higgsfield",
    model: "gpt_image_2",
    operation: "reference_frames",
    estimatedCostUsd: styles.length * COST_ESTIMATES_USD.gpt_image_2,
    dailyBudgetUsd: policy.limits.maxGenerationCostPerDayUsd,
  });
  const results = await Promise.allSettled(
    styles.map(async (style) => {
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
    await release(actionId);
    throw new Error(`All reference-frame candidates failed: ${failures[0]?.reason instanceof Error ? failures[0].reason.message : "unknown"}`);
  }
  await settle(actionId, frames.length * COST_ESTIMATES_USD.gpt_image_2);
  log.info("reference frames generated", { requested: styles.length, succeeded: frames.length });
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

/** Lowest-risk look for UNATTENDED posting — credible documentary realism,
 *  not the bold/experimental styles an operator might pick with an eye on it. */
const AUTONOMOUS_WORLD_STYLE: VisualWorldStyle = "safe";

/**
 * Give an AUTONOMOUS (cron / manufacturing) reel a visual-continuity anchor.
 *
 * The audit gap (#8): only the operator Studio path attaches a Visual World, so
 * every daily reel generates independent beats with no shared identity — the
 * baseline drift defect the whole long-haul set out to kill. When
 * REEL_AUTO_VISUAL_WORLD is on and the brief has no operator-approved world,
 * generate ONE "safe" reference frame and attach it: its locked invariants then
 * flow into every beat prompt (buildReelContinuityBlock prefers them), and if
 * REEL_IMAGE_CONDITIONING is also on, heroFrameUrl anchors --start-image.
 *
 * COST: one gpt_image_2 call per reel when enabled — hence default OFF ($0
 * until the operator flips the flag). Failure is NON-FATAL: the reel proceeds
 * text-only, never blocked.
 *
 * KNOWN LIMIT (audit #11): the auto-selected frame is not yet vision-audited
 * for defects before use — a bad anchor would propagate to every beat. That
 * guard + a live --start-image render are the gates before this ships ON in
 * prod. Until then the flag stays OFF and this is dead-safe wiring.
 */
export async function attachAutonomousVisualWorld(brief: ReelBrief): Promise<ReelBrief> {
  if (process.env.REEL_AUTO_VISUAL_WORLD !== "true") return brief;
  if (brief.visualWorld?.lockedInvariants?.trim()) return brief; // already anchored (operator path)
  try {
    const [candidate] = await generateReferenceFrames(brief, [AUTONOMOUS_WORLD_STYLE]);
    if (!candidate) {
      log.warn("autonomous visual world skipped — no candidate frame", { briefId: brief.id });
      return brief;
    }
    // M7: if the frame WILL be used as an image-conditioning anchor, screen the
    // ACTUAL pixels first — a defective anchor (garbled text / fake logo / hands)
    // propagates to every beat (audit #11). Only screen when conditioning is on
    // (a paid vision call); a failed/unavailable screen falls back to text-only.
    if (process.env.REEL_IMAGE_CONDITIONING === "true") {
      const { screenReferenceFrame, referenceFrameVerdict } = await import("./referenceFrameScreen");
      const verdict = referenceFrameVerdict(await screenReferenceFrame(candidate.url), { requireScreen: true });
      if (!verdict.accept) {
        log.warn("autonomous visual world rejected — defective anchor; reel proceeds text-only", { briefId: brief.id, reasons: verdict.reasons });
        return brief;
      }
    }
    brief.visualWorld = visualWorldFromCandidate(candidate);
    log.info("autonomous visual world attached", { briefId: brief.id, style: candidate.style });
    return brief;
  } catch (err) {
    log.warn("autonomous visual world generation failed — reel proceeds text-only", {
      briefId: brief.id,
      err: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return brief;
  }
}
