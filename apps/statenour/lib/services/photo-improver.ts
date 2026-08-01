/**
 * lib/services/photo-improver.ts · misc-pages slice (2026-05-22 ·
 * legacy-modernizer REST→tRPC).
 *
 * The storefront/car/shop photo-improver pipeline · lifted verbatim
 * from app/api/images/improve/route.ts (vision-model analysis →
 * scorecard + improvements + a Nick's-Tire branded re-render). The
 * legacy REST endpoint AND the new `operator.improvePhoto` tRPC
 * procedure call the SAME `improvePhoto` function · drift between
 * consumers structurally impossible.
 *
 * `improvePhoto` returns an EXPLICIT, shallow shape (`ImproveResult`).
 * No Prisma rows are involved (the only persistence is the
 * fire-and-forget `trackGeneration` telemetry) so there is no Json
 * column to firewall — but the explicit interface keeps the procedure
 * type stable regardless.
 */

import { generateImageWithFallback } from "@/lib/ai/gemini-image";
import { trackGeneration } from "@/lib/ai/track";
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { PROVIDERS_REGISTRY } from "@/config/ai-providers";

// 2026-08-01 · was hardcoded to qwen3-vl:235b-instruct, RETIRED on Ollama
// Cloud 2026-06-16 (HTTP 410). Unconditional — so the ollama leg of this
// pipeline had been dead since, failing quietly into the fallback because
// the request is wrapped in `if (res.ok)` + try/catch. Sourced from the
// registry now, so a future retirement is a one-line config change.
const OLLAMA_VISION_MODEL =
  process.env.OLLAMA_VISION_MODEL?.trim() ||
  PROVIDERS_REGISTRY.ollama.defaultVisionModel ||
  PROVIDERS_REGISTRY.ollama.defaultModel;

const ANALYZE_INSTRUCTION = `You are Nick, a marketing consultant for Nick's Tire & Auto in Cleveland.

Analyze this storefront/car/shop photo for marketing use. Return ONLY valid JSON matching this schema:

{
  "scores": {
    "lighting": 0-100,
    "framing": 0-100,
    "brandPresence": 0-100,
    "cleanliness": 0-100,
    "professionalPolish": 0-100,
    "overall": 0-100
  },
  "subject": "Brief description — '2014 Toyota Camry on lift', 'storefront from across the street', 'wheel close-up', etc.",
  "currentMood": "What this photo currently communicates. 2-3 words. e.g. 'cluttered, amateur', 'clean, professional', 'sterile, corporate'.",
  "issues": ["specific issue 1 (max 15 words)", "specific issue 2", ...up to 5],
  "improvements": [
    {
      "type": "crop" | "lighting" | "framing" | "brand" | "edit",
      "instruction": "Specific actionable change (max 25 words)",
      "priority": "high" | "medium" | "low"
    }
  ],
  "marketingFit": {
    "instagram": "good" | "ok" | "bad",
    "facebook": "good" | "ok" | "bad",
    "gbp": "good" | "ok" | "bad",
    "billboard": "good" | "ok" | "bad",
    "best": "instagram" | "facebook" | "gbp" | "billboard"
  },
  "rebrandPrompt": "If we re-render this scene with Nick's Tire brand applied, the prompt for recraft-v4 would be: ... (one detailed paragraph, include 'gold #FDB913 accent', 'professional automotive photography', 'Cleveland independent shop')"
}

Output JSON only, no commentary.`;

export interface AnalysisResult {
  scores: {
    lighting: number;
    framing: number;
    brandPresence: number;
    cleanliness: number;
    professionalPolish: number;
    overall: number;
  };
  subject: string;
  currentMood: string;
  issues: string[];
  improvements: Array<{
    type: "crop" | "lighting" | "framing" | "brand" | "edit";
    instruction: string;
    priority: "high" | "medium" | "low";
  }>;
  marketingFit: {
    instagram: "good" | "ok" | "bad";
    facebook: "good" | "ok" | "bad";
    gbp: "good" | "ok" | "bad";
    billboard: "good" | "ok" | "bad";
    best: "instagram" | "facebook" | "gbp" | "billboard";
  };
  rebrandPrompt: string;
}

/** Shallow, explicit result shape · mirrors the legacy route's JSON
 *  envelope + the page's `ImproveResponse` interface. */
export interface ImproveResult {
  ok: true;
  mode: "analyze" | "rebrand" | "both";
  analysis: AnalysisResult | null;
  analysisModel: string;
  analysisDurationMs: number;
  rebrandedImageUrl?: string;
  rebrandedImageId?: string;
  rebrandModel?: string;
  rebrandDurationMs?: number;
}

type ImageContent = { type: string; image_url: { url: string } };

async function analyzeWithVision(imageContent: ImageContent): Promise<{
  analysis: AnalysisResult | null;
  model: string;
  durationMs: number;
}> {
  const t0 = Date.now();

  // Try Ollama Cloud qwen3-vl first
  const ollamaKey = process.env.OLLAMA_API_KEY;
  const ollamaBase = process.env.OLLAMA_BASE_URL || "https://ollama.com";
  if (ollamaKey && ollamaKey.length > 20) {
    try {
      const res = await fetch(`${ollamaBase}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ollamaKey}`,
        },
        body: JSON.stringify({
          model: OLLAMA_VISION_MODEL,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: ANALYZE_INSTRUCTION },
                imageContent,
              ],
            },
          ],
          temperature: 0.4,
          max_tokens: 1500,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) {
          return {
            analysis: parseAnalysis(text),
            model: OLLAMA_VISION_MODEL,
            durationMs: Date.now() - t0,
          };
        }
      }
    } catch (err) {
      console.warn(
        "[improve] Ollama failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // OpenAI fallback
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: ANALYZE_INSTRUCTION },
                imageContent,
              ],
            },
          ],
          temperature: 0.4,
          max_tokens: 1500,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) {
          return {
            analysis: parseAnalysis(text),
            model: "gpt-4o-mini",
            durationMs: Date.now() - t0,
          };
        }
      }
    } catch (err) {
      console.warn(
        "[improve] OpenAI failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { analysis: null, model: "vision_unavailable", durationMs: Date.now() - t0 };
}

function parseAnalysis(text: string): AnalysisResult | null {
  // Strip markdown fences
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*$/g, "")
    .trim();
  // v10.0.229 · use shared extractor with repair pass
  const extracted = extractJsonObject<AnalysisResult>(cleaned);
  return extracted.ok ? extracted.value : null;
}

export class MissingImageError extends Error {
  constructor() {
    super("missing_image");
    this.name = "MissingImageError";
  }
}

export interface ImprovePhotoInput {
  imageBase64?: string;
  imageUrl?: string;
  mode?: "analyze" | "rebrand" | "both";
}

/**
 * Run the photo-improver pipeline. `mode` controls which legs fire,
 * preserving the legacy route's exact branching:
 *   · analyze  — vision-model scorecard only
 *   · both     — analyze, then rebrand using the analysis' rebrandPrompt
 *   · rebrand  — the rebrand leg is gated on `analysis?.rebrandPrompt`,
 *                but `analyzeWithVision` only runs for analyze/both ·
 *                so `rebrand`-only leaves `analysis` null and produces
 *                no re-render. This is a pre-existing quirk of the
 *                legacy route, preserved verbatim (the page only ever
 *                sends "both" by default).
 *
 * Throws `MissingImageError` when neither `imageBase64` nor `imageUrl`
 * is supplied — the route + tRPC layer translate it to a 400 / a
 * BAD_REQUEST identically.
 */
export async function improvePhoto(
  input: ImprovePhotoInput,
): Promise<ImproveResult> {
  if (!input.imageBase64 && !input.imageUrl) {
    throw new MissingImageError();
  }

  const mode = input.mode ?? "both";

  const imageContent: ImageContent = input.imageBase64
    ? {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${input.imageBase64}` },
      }
    : { type: "image_url", image_url: { url: input.imageUrl! } };

  let analysis: AnalysisResult | null = null;
  let analysisModel = "skipped";
  let analysisDurationMs = 0;

  if (mode === "analyze" || mode === "both") {
    const r = await analyzeWithVision(imageContent);
    analysis = r.analysis;
    analysisModel = r.model;
    analysisDurationMs = r.durationMs;
    if (analysis) {
      void trackGeneration({
        feature: "image_improve_analyze",
        model: analysisModel,
        durationMs: analysisDurationMs,
        status: "complete",
      });
    }
  }

  let rebrandedImageUrl: string | undefined;
  let rebrandedImageId: string | undefined;
  let rebrandModel: string | undefined;
  let rebrandDurationMs: number | undefined;

  if ((mode === "rebrand" || mode === "both") && analysis?.rebrandPrompt) {
    try {
      const rebrandT0 = Date.now();
      const result = await generateImageWithFallback(analysis.rebrandPrompt, {
        autoAspect: true,
      });
      rebrandedImageUrl = result.imageUrl;
      rebrandedImageId = result.imageId;
      rebrandModel = result.model;
      rebrandDurationMs = Date.now() - rebrandT0;
      void trackGeneration({
        feature: "image_improve_rebrand",
        model: result.model,
        promptTokens: 50_000,
        durationMs: rebrandDurationMs,
        status: "complete",
      });
    } catch (err) {
      console.warn(
        "[improve] rebrand failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    ok: true,
    mode,
    analysis,
    analysisModel,
    analysisDurationMs,
    rebrandedImageUrl,
    rebrandedImageId,
    rebrandModel,
    rebrandDurationMs,
  };
}
