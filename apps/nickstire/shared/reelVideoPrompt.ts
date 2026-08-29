/**
 * The per-beat video prompt, as a STRUCTURED SHOT SPEC rather than prose.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Two measured facts, 2026-08-29.
 *
 * 1. A generation run through Veo 3.1 returned `enhance_prompt: true` and had
 *    silently REWRITTEN a two-sentence prose prompt into labelled blocks -
 *    SUBJECT / SCENE / VISUAL DETAILS / ACTION AND CAMERA MOTION /
 *    CINEMATOGRAPHY / AUDIO / STYLE. The model was doing for free, and
 *    unpredictably, what the caller should be doing deliberately. The block
 *    names below are copied from that observed output; they are not invented.
 *
 * 2. `reelPipeline.ts` sent the model `beat.visual` and NOTHING ELSE, while
 *    every beat also carries `motion` and `audioCue`. Those two were believed
 *    lost at the payload boundary because `ReelJobBrief` did not declare them.
 *    Reading three real payloads from prod refuted that: jobs 1770003/4/5 all
 *    carry `motion`, two carry `audioCue`. The whole brief is JSON.stringify'd
 *    at enqueue, and a TypeScript type does not strip fields at runtime - so
 *    the data was there the entire time and only the TYPE hid it. Declaring
 *    the fields is the whole fix; no migration, no payload rewrite.
 *
 * That is the same shape as the clip audio the assembler discards: produced on
 * every run, paid for, never delivered. This costs nothing per clip.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 * It does not split `visual` prose into SUBJECT vs SCENE vs VISUAL DETAILS.
 * Nothing here can do that correctly, and a wrong split is worse than an honest
 * one. `visual` fills SCENE; SUBJECT takes it too when no distinct subject
 * exists. If a future schema asks the model for those separately, fill them
 * here - do not guess in the meantime.
 *
 * It is also NOT enforced at runtime. `promptShapeProblem` is the CANARY's
 * subject, not a gate: rejecting a live payload that happens to lack `motion`
 * would fail generation for a cosmetic reason. The builder degrades; the test
 * asserts the shape.
 */

/** The block names, in the order the observed model output used them. */
export const PROMPT_BLOCKS = [
  "SUBJECT",
  "SCENE",
  "VISUAL DETAILS",
  "ACTION AND CAMERA MOTION",
  "CINEMATOGRAPHY",
  "AUDIO",
  "STYLE",
] as const;

/** Blocks that make a prompt a shot spec. A prompt missing these is prose. */
export const REQUIRED_BLOCKS: readonly string[] = ["SUBJECT", "SCENE", "ACTION AND CAMERA MOTION"];

export interface PromptBeat {
  /** Prose description of the shot. Previously the ONLY field that reached the model. */
  visual?: string | null;
  /** Camera / subject movement. In the payload all along; previously undeclared. */
  motion?: string | null;
  /** Diegetic sound intent. In the payload all along; previously undeclared. */
  audioCue?: string | null;
}

export interface PromptBrief {
  /** Cinematography direction for the whole reel, when the brief carries one. */
  motionLens?: string | null;
  /** Tonal archetype for the whole reel. */
  archetype?: string | null;
  /** The recurring object character, when the brief declares one. */
  objectCharacter?: string | null;
}

const clean = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * Compose the structured prompt.
 *
 * Empty blocks are OMITTED rather than emitted with a placeholder: a labelled
 * empty section reads to a model as an invitation to invent one, which is how a
 * reel about brake pads acquires a narrator describing a sunset.
 */
export function buildStructuredVideoPrompt(beat: PromptBeat, brief: PromptBrief = {}): string {
  const visual = clean(beat.visual);
  const subject = clean(brief.objectCharacter) || visual;

  const blocks: [string, string][] = [
    ["SUBJECT", subject],
    ["SCENE", visual],
    ["VISUAL DETAILS", ""],
    ["ACTION AND CAMERA MOTION", clean(beat.motion)],
    ["CINEMATOGRAPHY", clean(brief.motionLens)],
    ["AUDIO", clean(beat.audioCue)],
    ["STYLE", clean(brief.archetype)],
  ];

  return blocks
    .filter(([, body]) => body.length > 0)
    .map(([name, body]) => `${name}: ${body}`)
    .join("\n");
}

/**
 * Why this prompt is not a structured shot spec, or null when it is.
 *
 * THIS IS THE CANARY'S SUBJECT. The failure mode guarded is not a crash - it is
 * someone editing the pipeline so raw prose flows to the model again, which
 * would look entirely normal and would silently undo the change. Asserting the
 * SHAPE is the only way that regression announces itself.
 */
export function promptShapeProblem(prompt: string): string | null {
  const text = String(prompt ?? "");
  if (!text.trim()) return "prompt is empty";

  const missing = REQUIRED_BLOCKS.filter((b) => !new RegExp(`^${b}:`, "m").test(text));
  if (missing.length) {
    return (
      `prompt is not a structured shot spec - missing block(s) [${missing.join(", ")}]. ` +
      "Raw prose reaches the model as an unlabelled paragraph and it imposes its own " +
      "structure unpredictably. Build it with buildStructuredVideoPrompt()."
    );
  }
  return null;
}
