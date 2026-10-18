/**
 * Photo Improver for the admin (ported from statenour /photo-improver, 2026-10-18).
 *
 * Two operator-tapped legs behind instagramStudio.checkPhoto and instagramStudio.brandedPhoto:
 *
 *   1. analyzePhotoForShop  a vision model scores a shop photo and says what to change.
 *   2. renderBrandedScene   an image model draws a NEW branded scene from a text prompt.
 *
 * HONESTY CONTRACT FOR THE UI COPY:
 *   - The scorecard is one vision model's opinion of one photo, not a measurement. Every ok result
 *     carries the model that said it so the screen can show that.
 *   - The branded picture is TEXT-TO-IMAGE. It does not edit or restyle the uploaded photo; it is
 *     a fresh render from the prompt (usually the scorecard's own rebrandPrompt). Say "new image
 *     in Nick's style", never "your photo, improved".
 *   - Preview only. Nothing here posts, publishes or sends.
 *
 * A failed read is never a number: a vision outage, an unusable reply and a refused URL each come
 * back as a named failure with no `analysis` key (empty-vs-error).
 *
 * shortcut: admin-only, one tap per render, no daily cap and no credit ledger. generateImage can
 * spend a second provider call inside one invocation (Gemini, then its OpenAI fallback), so one
 * tap is at most two provider calls. Add a cap if usage grows (it was 4 uses in 90 days).
 */
import { z } from "zod";
import { generateImage } from "../_core/imageGeneration";
import { createLogger } from "../lib/logger";
import { analyzePhoto } from "./vision-analyzer";

const log = createLogger("services:photoImprover");

/** The bounds brandedPhoto enforces on its prompt; the scorecard's rebrandPrompt is shaped to fit them. */
export const BRANDED_PROMPT_MIN = 20;
export const BRANDED_PROMPT_MAX = 2000;

// Gemini only, on purpose. analyzePhoto caps the reply at 800 tokens on Gemini, 600 on Ollama and
// 256 on Replicate, and a scorecard needs about 500: a Replicate key would truncate every reply
// into "unreadable". No Gemini key means vision_unavailable, not a weaker provider. Gemini is the
// key production already holds for image generation.
const VISION_PROVIDER = "gemini" as const;

const ANALYZE_INSTRUCTION = `You are a marketing consultant for Nick's Tire & Auto, an independent shop in Cleveland.

Analyze this storefront, car or shop photo for marketing use. Judge only what is visible. Return ONLY valid JSON matching this schema, no commentary, and keep every string short:

{
  "scores": {
    "lighting": 0-100,
    "framing": 0-100,
    "brandPresence": 0-100,
    "cleanliness": 0-100,
    "professionalPolish": 0-100,
    "overall": 0-100
  },
  "subject": "What the photo shows, max 12 words",
  "currentMood": "What the photo communicates now, 2-3 words",
  "issues": ["specific issue, max 15 words", "up to 4 items"],
  "improvements": [
    { "type": "crop" | "lighting" | "framing" | "brand" | "edit", "instruction": "specific change, max 20 words", "priority": "high" | "medium" | "low" }
  ],
  "marketingFit": {
    "instagram": "good" | "ok" | "bad",
    "facebook": "good" | "ok" | "bad",
    "gbp": "good" | "ok" | "bad",
    "billboard": "good" | "ok" | "bad",
    "best": "instagram" | "facebook" | "gbp" | "billboard"
  },
  "rebrandPrompt": "One paragraph, under 90 words, written for an image model that will draw this scene fresh with Nick's brand applied. Include 'gold #FDB913 accent', 'professional automotive photography' and 'Cleveland independent shop'."
}

Use at most 4 improvements. Output JSON only.`;

const score = z
  .number()
  .finite()
  .transform((n) => Math.round(Math.min(100, Math.max(0, n))));
const fit = z.enum(["good", "ok", "bad"]);
const short = z
  .string()
  .trim()
  .min(1)
  .transform((s) => s.slice(0, 300));

/**
 * What the vision model must return. Anything missing or off-list fails the parse (the caller
 * reports "unreadable"); scores are clamped to 0..100, and the lists a model can pad are capped.
 */
export const photoAnalysisSchema = z.object({
  scores: z.object({
    lighting: score,
    framing: score,
    brandPresence: score,
    cleanliness: score,
    professionalPolish: score,
    overall: score,
  }),
  subject: short,
  currentMood: short,
  issues: z.array(short).transform((a) => a.slice(0, 5)),
  improvements: z
    .array(
      z.object({
        type: z.enum(["crop", "lighting", "framing", "brand", "edit"]),
        instruction: short,
        priority: z.enum(["high", "medium", "low"]),
      }),
    )
    .transform((a) => a.slice(0, 5)),
  marketingFit: z.object({
    instagram: fit,
    facebook: fit,
    gbp: fit,
    billboard: fit,
    best: z.enum(["instagram", "facebook", "gbp", "billboard"]),
  }),
  rebrandPrompt: z
    .string()
    .trim()
    .min(BRANDED_PROMPT_MIN)
    .transform((s) => s.slice(0, BRANDED_PROMPT_MAX)),
});

export type PhotoAnalysis = z.output<typeof photoAnalysisSchema>;

export type CheckPhotoResult =
  | { ok: true; analysis: PhotoAnalysis; model: string; durationMs: number }
  | { ok: false; reason: "vision_unavailable" | "unreadable" | "invalid_url"; message: string };

export type BrandedPhotoResult =
  | { ok: true; imageUrl: string; model: string; durationMs: number }
  | { ok: false; reason: "image_unavailable"; message: string };

const MESSAGES = {
  vision_unavailable: "The photo check is not available right now. Try again in a minute.",
  unreadable: "The photo check came back in a form we could not read. Try again.",
  invalid_url: "That photo link could not be opened. Upload the photo again.",
  image_unavailable: "The picture could not be made right now. Try again in a minute.",
} as const;

/** The JSON object inside a model reply: fences, a lead-in sentence or a trailing note are tolerated. */
function jsonObjectIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function analyzePhotoForShop(input: { photoUrl: string }): Promise<CheckPhotoResult> {
  const t0 = Date.now();
  if (!process.env.GEMINI_API_KEY) {
    log.warn("photo check skipped: no GEMINI_API_KEY");
    return { ok: false, reason: "vision_unavailable", message: MESSAGES.vision_unavailable };
  }

  let reply: Awaited<ReturnType<typeof analyzePhoto>>;
  try {
    // internal + explicit provider: an operator-side read, not the customer MMS pipeline the
    // photo_assess_enabled flag gates (vision-analyzer AnalyzePhotoOptions.internal).
    reply = await analyzePhoto({ photoUrl: input.photoUrl, prompt: ANALYZE_INSTRUCTION, provider: VISION_PROVIDER, internal: true });
  } catch (err) {
    log.warn("photo check threw", { error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return { ok: false, reason: "vision_unavailable", message: MESSAGES.vision_unavailable };
  }

  if (!reply.ok) {
    log.warn("photo check failed", { reason: reply.reason, error: reply.error.slice(0, 200) });
    const reason = reply.reason === "invalid_url" ? "invalid_url" : "vision_unavailable";
    return { ok: false, reason, message: MESSAGES[reason] };
  }

  const parsed = photoAnalysisSchema.safeParse(jsonObjectIn(reply.description));
  if (!parsed.success) {
    log.warn("photo check reply was not a scorecard", { model: reply.modelName, chars: reply.description.length });
    return { ok: false, reason: "unreadable", message: MESSAGES.unreadable };
  }

  const durationMs = Date.now() - t0;
  log.info("photo check done", { model: reply.modelName, durationMs });
  return { ok: true, analysis: parsed.data, model: reply.modelName, durationMs };
}

export async function renderBrandedScene(input: { prompt: string }): Promise<BrandedPhotoResult> {
  const t0 = Date.now();
  // The id of the configured primary. generateImage may fall back to its OpenAI path inside this
  // one call without telling us, so this names what was asked for, not proof of what answered.
  const model = process.env.GEMINI_API_KEY ? process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image" : "dall-e-3";
  try {
    // One call, no retry: each attempt spends image credit, and a second try is the operator's tap.
    const { url } = await generateImage({ prompt: input.prompt });
    if (!url) {
      log.warn("branded photo: generator returned no url", { model });
      return { ok: false, reason: "image_unavailable", message: MESSAGES.image_unavailable };
    }
    const durationMs = Date.now() - t0;
    log.info("branded photo done", { model, durationMs });
    return { ok: true, imageUrl: url, model, durationMs };
  } catch (err) {
    log.warn("branded photo failed", { model, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return { ok: false, reason: "image_unavailable", message: MESSAGES.image_unavailable };
  }
}
