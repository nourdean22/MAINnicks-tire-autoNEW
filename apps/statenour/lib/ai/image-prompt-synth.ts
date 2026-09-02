/**
 * Image prompt synthesis from conversation context
 *
 * Apr 27 · The image fast-path was sending the literal user prompt to
 * Venice. When the user typed "now generate the picture" after writing
 * an Instagram caption, Venice got 4 referential words with zero
 * subject and produced a generic mountain meadow.
 *
 * This module:
 *   1. Detects when the user prompt is "referential" — short commands
 *      that point back to context ("now generate the picture", "make it
 *      now", "do that one", "the image too").
 *   2. When detected AND a prior assistant turn exists, calls a fast LLM
 *      to synthesize a real visual description from the prior context.
 *   3. Falls back to the literal user prompt on any failure (LLM down,
 *      timeout, empty response).
 *
 * The synthesized prompt then flows through the normal brand-context
 * tier injection (lib/ai/brand-context.ts) — so a synthesized prompt
 * about "tire damage at Cleveland shop" picks up the partial-tier
 * brand system, while a synthesized prompt about "my dog at the beach"
 * skips brand entirely.
 *
 * Latency budget: ~1-2s for the synth call. Trades a small wait for
 * a dramatically more relevant image. Skipped entirely (zero cost)
 * when the user's prompt isn't referential.
 */

import { langfuseTelemetry } from "@/lib/observability/langfuse";
import { generateText } from "ai";
import { getModel } from "./provider";

// ── Detection ─────────────────────────────────────────────────────
// "Referential" = the user's prompt has no concrete subject and points
// back at prior conversation. Examples:
//   · "now generate the picture"
//   · "make it now"
//   · "do that one"
//   · "the image too"
//   · "now do it"
//   · "render it"
//   · "the picture for that"
// Counter-examples (NOT referential — already self-contained):
//   · "generate me a tire ad with a Civic on a lift"
//   · "make a picture of the Cleveland skyline at sunset"
//   · "draw a logo with a wrench"

const REFERENTIAL_VERB =
  /\b(generate|gen|make|create|do|render|design|draw|build|cook\s+up|whip\s+up|show)\b/i;
const REFERENTIAL_OBJECT =
  /\b(it|that|this|the\s+(image|picture|pic|photo|visual|graphic|one|post|ad|banner|flyer|thing|picutre|pictrue))\b/i;
const PROMPT_LEAD_REFERENTIAL =
  /^(now|then|next|ok|okay|good|great|so|and|also|alright)?\s*(the\s+(image|picture|pic|photo|visual|graphic|one|post|ad|banner|flyer))\b/i;

// v10.0.332 · regen / refinement detection. When the user complains about
// a previous image (turn 16 glitch · the user said "the image has glitches
// looks generic do it again make it professional" → that 18-word request
// failed the looksReferential 10-word cap and went through to the image
// generator AS THE LITERAL PROMPT, producing an image with the user's
// complaint baked into it).
const REGEN_KEYWORDS =
  /\b(do\s+it\s+again|redo|regen|regenerate|try\s+again|once\s+more|another\s+(try|version|attempt|one)|different\s+(version|take|attempt|one)|make\s+it\s+(more|less|cleaner|sharper|smaller|bigger|brighter|darker|professional|crisp|clean)|improve\s+(it|the)|refine|fix\s+it|polish\s+(it|the))\b/i;
const REGEN_QUALITY_HINTS =
  /\b(glitch|generic|bad|poor\s+quality|low\s+quality|amateur|cheap|sloppy|messy|broken|weird|off|ugly|blurry)\b/i;

/**
 * Detect refinement / regen asks. The user references the PRIOR image and
 * wants a fixed/different version. Different from looksReferential because:
 *   · Word count can be high (complaints are verbose: "the image has X
 *     issues fix it" is 8-20 words)
 *   · The prior turn must be an image (caller should check)
 *   · Synthesis pulls the PRIOR image's prompt and rewrites it with the
 *     user's refinement notes (vs. building a new prompt from text content)
 */
export function looksLikeRegenAsk(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return false;
  // Cap at 60 words — past that the user is writing a fresh detailed prompt
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > 60) return false;
  // Direct regen verbs ("do it again", "redo", "another version")
  if (REGEN_KEYWORDS.test(trimmed)) return true;
  // Quality complaint + short prompt = also a regen ask
  if (wordCount <= 30 && REGEN_QUALITY_HINTS.test(trimmed)) return true;
  return false;
}

export function looksReferential(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return false;
  // Anything past 10 words is detailed enough to send literally
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > 10) return false;
  // Verb + referential pronoun/article pattern
  if (REFERENTIAL_VERB.test(trimmed) && REFERENTIAL_OBJECT.test(trimmed)) {
    return true;
  }
  // Bare "the picture too" / "the image as well"
  if (PROMPT_LEAD_REFERENTIAL.test(trimmed)) return true;
  return false;
}

// v10.0.332 · extract the prior image's prompt from an assistant turn.
// Image-gen turns store their prompt as `**Prompt:** <text>` (see
// lib/ai/chat/interceptors.ts line 650) so we can recover it for regen
// synthesis without round-tripping the database.
export function extractPriorImagePrompt(priorAssistant: string | null | undefined): string | null {
  if (!priorAssistant) return null;
  // The image-gen turn looks like:
  //   ![Generated Image](/api/images/...)
  //
  //   **Prompt:** <prompt text>
  //   **Model:** ...
  // Capture the **Prompt:** line through end-of-line OR the **Model:** marker.
  const match = /\*\*Prompt:\*\*\s+([^\n]+(?:\n(?!\*\*[A-Z])[^\n]+)*)/i.exec(priorAssistant);
  if (!match) return null;
  return match[1].trim();
}

// ── Synthesis ─────────────────────────────────────────────────────

export interface SynthesizeArgs {
  userPrompt: string;
  priorAssistant?: string | null;
  priorUser?: string | null;
}

export interface SynthesizeResult {
  prompt: string;
  synthesized: boolean;
  reason?: string;
}

const SYNTH_SYSTEM = `You are an image prompt synthesizer. The user previously asked the assistant for written content (a caption, an ad, an Instagram post, a brainstorm). They now want an image to go with that content.

Read the prior assistant turn, then write ONE concrete sentence describing exactly what the image should show. Be specific about subjects, setting, mood, and key props.

Rules:
- Output ONLY the visual description — no preface, no "an image of", no quotes.
- Pull the visual subject from the prior content (what's the post about?).
- Keep it to 1-2 sentences max.
- Be specific (mention objects, location, action, mood).`;

// v10.0.332 · regen / refinement system prompt. Different framing — the
// user is complaining about a previous image and wants a refined version.
// The synth merges the PRIOR image prompt with the user's refinement
// notes instead of rewriting from scratch.
const REGEN_SYNTH_SYSTEM = `You are an image prompt refiner. The user just generated an image and is unhappy with the result. They've described what's wrong and want a better version.

You will be given:
- The prompt that produced the failed image (PRIOR PROMPT)
- The user's complaint / refinement notes (USER FEEDBACK)

Your job: rewrite the prompt to keep the same SUBJECT and PURPOSE but address the user's complaints. Add specificity, fix quality issues, bump production-grade adjectives where the user asked.

Rules:
- Output ONLY the refined visual description — no preface, no quotes, no markdown.
- Keep the original subject and composition unless the user explicitly asked to change them.
- If the user says "more professional / sharper / cleaner / higher quality", inject those adjectives + specifics like lighting, composition, materials.
- 1-2 sentences max.
- Don't include the user's complaint text in the prompt — the prompt goes to a render model that takes everything literally.`;

export async function synthesizeImagePrompt(
  args: SynthesizeArgs,
): Promise<SynthesizeResult> {
  const { userPrompt, priorAssistant, priorUser } = args;
  const cleaned = userPrompt.trim();

  // v10.0.332 · regen-ask path takes priority over self-contained
  // detection. A regen ask (e.g. "do it again make it sharper") looks
  // self-contained at >10 words, but it's actually referencing the
  // prior image and shouldn't go to the render model literally.
  const isRegenAsk = looksLikeRegenAsk(cleaned);
  const priorImagePrompt = isRegenAsk ? extractPriorImagePrompt(priorAssistant) : null;

  // Pass-through: prompt already has enough specifics (and isn't a regen)
  if (!isRegenAsk && !looksReferential(cleaned)) {
    return { prompt: cleaned, synthesized: false, reason: "self-contained" };
  }

  // Pass-through: no prior context to synthesize from
  if (!priorAssistant?.trim()) {
    return { prompt: cleaned, synthesized: false, reason: "no-prior" };
  }

  // v10.0.332 · regen branch — the user is refining a previously
  // generated image. Pull the prior image's prompt and rewrite with
  // the user's feedback instead of using their feedback as the prompt.
  if (isRegenAsk && priorImagePrompt) {
    return synthesizeRegenPrompt({
      userFeedback: cleaned,
      priorImagePrompt,
    });
  }

  // Truncate prior to keep the synth call cheap (1500 char ≈ 400 tokens)
  const priorContext = priorAssistant.slice(0, 1500);
  const priorUserCtx = (priorUser ?? "").slice(0, 300);

  const synthUser = [
    priorUserCtx ? `EARLIER USER ASK:\n"${priorUserCtx}"\n` : "",
    `PRIOR ASSISTANT TURN:`,
    priorContext,
    ``,
    `USER NOW SAID: "${cleaned}"`,
    ``,
    `Image description (one concrete sentence describing the visual):`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const model = getModel("fast");
    const { text } = await generateText({
      model,
      experimental_telemetry: langfuseTelemetry({ functionId: "image-prompt-synth" }),
      system: SYNTH_SYSTEM,
      prompt: synthUser,
      maxOutputTokens: 200,
      temperature: 0.4,
      // Keep the synth fast — abort after 8s and fall back to literal
      abortSignal: AbortSignal.timeout(8000),
    });
    const synthesized = text
      .trim()
      .replace(/^["'`]|["'`]$/g, "")
      .replace(/^(image|picture|visual)\s+description\s*:\s*/i, "")
      .replace(/^(an?\s+)?image\s+of\s+/i, "")
      .replace(/^(a\s+)?(visual|picture|photo)\s+of\s+/i, "")
      .trim();
    if (!synthesized || synthesized.length < 10) {
      return { prompt: cleaned, synthesized: false, reason: "empty-result" };
    }
    console.log(
      `[image-synth] "${cleaned}" → "${synthesized.slice(0, 80)}${synthesized.length > 80 ? "…" : ""}"`,
    );
    return { prompt: synthesized, synthesized: true };
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`[image-synth] failed (${msg}) — using literal prompt`);
    return { prompt: cleaned, synthesized: false, reason: `error:${msg}` };
  }
}

// v10.0.332 · regen synthesis · merge prior prompt + user feedback into a
// refined render prompt. Falls back to the prior prompt verbatim if the
// LLM call fails (better than passing the user's complaint through as a
// render prompt, which is what produced the original glitch).
async function synthesizeRegenPrompt(args: {
  userFeedback: string;
  priorImagePrompt: string;
}): Promise<SynthesizeResult> {
  const { userFeedback, priorImagePrompt } = args;
  const synthUser = [
    `PRIOR PROMPT (the image that failed):`,
    priorImagePrompt,
    ``,
    `USER FEEDBACK (what they want fixed):`,
    `"${userFeedback}"`,
    ``,
    `Refined prompt (one concrete sentence describing the visual, with the user's fixes applied):`,
  ].join("\n");

  try {
    const model = getModel("fast");
    const { text } = await generateText({
      model,
      experimental_telemetry: langfuseTelemetry({ functionId: "image-prompt-regen" }),
      system: REGEN_SYNTH_SYSTEM,
      prompt: synthUser,
      maxOutputTokens: 250,
      temperature: 0.4,
      abortSignal: AbortSignal.timeout(8000),
    });
    const refined = text
      .trim()
      .replace(/^["'`]|["'`]$/g, "")
      .replace(/^(refined|new|updated)\s+(prompt|image|description)\s*:\s*/i, "")
      .replace(/^(an?\s+)?image\s+of\s+/i, "")
      .trim();
    if (!refined || refined.length < 10) {
      // Fall back to the prior prompt rather than the user's feedback.
      // The prior prompt is at least a known-good visual description.
      console.warn(
        `[image-synth] regen synth empty — falling back to prior prompt`,
      );
      return {
        prompt: priorImagePrompt,
        synthesized: true,
        reason: "regen-fallback-prior",
      };
    }
    console.log(
      `[image-synth · regen] feedback="${userFeedback.slice(0, 60)}…" → "${refined.slice(0, 80)}${refined.length > 80 ? "…" : ""}"`,
    );
    return { prompt: refined, synthesized: true, reason: "regen-refined" };
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(
      `[image-synth] regen synth failed (${msg}) — using prior prompt verbatim`,
    );
    // Same defensive fallback as above — the prior prompt is the safest
    // alternative to the user's feedback going through as a literal prompt.
    return {
      prompt: priorImagePrompt,
      synthesized: true,
      reason: `regen-error-fallback:${msg}`,
    };
  }
}
