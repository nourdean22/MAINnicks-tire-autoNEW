/**
 * /api/images/improve — storefront photo improver.
 *
 * v6 · BATCH 7 · Apr 28. Upload a photo of the shop / a customer car /
 * a service in progress. Vision-model reads the image, returns:
 *   1. Specific issues + score (lighting, framing, brand presence,
 *      cleanliness, professional polish)
 *   2. Suggested improvements ("crop to 4:5", "add gold accent border",
 *      "reduce shadows", etc.)
 *   3. Branded variant — re-renders the same scene with Nick's Tire
 *      brand applied (gold text overlay, color grading, format)
 *
 * Body: { imageBase64?, imageUrl?, mode?: "analyze" | "rebrand" | "both" }
 * Returns: { analysis, improvements[], rebrandedImageUrl?, ... }
 *
 * Uses qwen3-vl for analysis (multimodal), recraft-v4 for rebrand
 * (graphic design + text rendering). Falls back to gpt-4o-mini for
 * analysis when Ollama is unavailable.
 *
 * Auth: session.
 */

import { NextResponse } from "next/server";
import { generateVeniceImage } from "@/lib/ai/venice-image";
import { trackGeneration } from "@/lib/ai/track";
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { requireSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

interface ImproveBody {
  imageBase64?: string;
  imageUrl?: string;
  mode?: "analyze" | "rebrand" | "both";
}

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

interface AnalysisResult {
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

async function analyzeWithVision(imageContent: { type: string; image_url: { url: string } }): Promise<{
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
          "Authorization": `Bearer ${ollamaKey}`,
        },
        body: JSON.stringify({
          model: "qwen3-vl:235b-instruct",
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
            model: "qwen3-vl:235b-instruct",
            durationMs: Date.now() - t0,
          };
        }
      }
    } catch (err) {
      console.warn("[improve] Ollama failed:", err instanceof Error ? err.message : err);
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
          "Authorization": `Bearer ${openaiKey}`,
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
      console.warn("[improve] OpenAI failed:", err instanceof Error ? err.message : err);
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

export async function POST(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  let body: ImproveBody;
  try {
    body = (await req.json()) as ImproveBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.imageBase64 && !body.imageUrl) {
    return NextResponse.json({ error: "missing_image" }, { status: 400 });
  }

  const mode = body.mode ?? "both";

  const imageContent = body.imageBase64
    ? { type: "image_url", image_url: { url: `data:image/png;base64,${body.imageBase64}` } }
    : { type: "image_url", image_url: { url: body.imageUrl! } };

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
      const result = await generateVeniceImage(analysis.rebrandPrompt, {
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
      console.warn("[improve] rebrand failed:", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({
    ok: true,
    mode,
    analysis,
    analysisModel,
    analysisDurationMs,
    rebrandedImageUrl,
    rebrandedImageId,
    rebrandModel,
    rebrandDurationMs,
  });
}
