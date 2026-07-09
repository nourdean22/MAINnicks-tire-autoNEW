/**
 * lib/ai/gemini-image.ts
 *
 * Google Gemini image-generation fallback for when Venice's
 * flux-2-pro is unavailable (402 no credit · 429 rate-limited).
 *
 * Uses `gemini-2.5-flash-image` (a.k.a. "nano-banana") via the
 * REST endpoint:
 *   https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent
 *
 * Auth · API key in the `x-goog-api-key` header (env GEMINI_API_KEY).
 * Output · 1024×1024 PNG via inline base64 in the response. Aspect
 * ratio isn't a direct parameter on this model · prompts can hint
 * it ("wide landscape", "portrait orientation", "square") but
 * we don't try to enforce it for the fallback case.
 */

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

export interface ImageResult {
  base64: string;
  dataUrl: string;
  imageUrl: string;
  imageId: string;
  prompt: string;
  model: string;
  size: string;
}

type AcceptedSize = "512x512" | "1024x1024" | "1536x1024" | "1024x1536";

export interface GeminiImageOptions {
  size?: AcceptedSize;
  /** Output prompt-string passthrough · used for AuditEvent detail + caller's record. */
  recordedPrompt?: string;
}

export function inferAspectRatio(prompt: string): "512x512" | "1024x1024" | "1536x1024" | "1024x1536" {
  if (!prompt) return "1024x1024";
  const p = prompt.toLowerCase();
  // 9:16 vertical — Stories, Reels, TikTok, Shorts, vertical video
  if (/\b(story|stories|reel|reels|tiktok|tik\s?tok|short|shorts|9:16|portrait\s+video|vertical(\s+video)?)\b/.test(p)) {
    return "1024x1536";
  }
  // 4:5 portrait — Instagram feed posts (recommended for max screen real estate)
  if (/\b(instagram(\s+post)?|feed\s+post|4:5|portrait\s+post)\b/.test(p)) {
    return "1024x1536";
  }
  // 16:9 landscape — billboards, banners, YouTube thumbnails, web hero
  if (/\b(billboard|banner|youtube\s+thumbnail|hero\s+image|landscape|16:9|widescreen)\b/.test(p)) {
    return "1536x1024";
  }
  // 1024×1024 — when "high quality" or "1024" mentioned (override default)
  if (/\b(high\s+quality|hi[-\s]?res|1024(x1024)?|hq|max\s+quality)\b/.test(p)) {
    return "1024x1024";
  }
  // Default — fastest, smallest payload
  return "512x512";
}

export async function generateGeminiImage(
  prompt: string,
  options: GeminiImageOptions = {},
): Promise<ImageResult> {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "Gemini image generation skipped: GEMINI_API_KEY not configured",
    );
  }

  const safePrompt = (prompt ?? "").trim();
  if (!safePrompt) {
    throw new Error("Gemini image generation failed: empty prompt");
  }
  const cappedPrompt =
    safePrompt.length > 2000 ? safePrompt.slice(0, 2000) : safePrompt;

  const sizeHint = options.size;
  let finalPrompt = cappedPrompt;
  if (sizeHint === "1536x1024") {
    finalPrompt += "\n\nOutput orientation: wide landscape (16:9-ish).";
  } else if (sizeHint === "1024x1536") {
    finalPrompt += "\n\nOutput orientation: tall portrait (2:3-ish).";
  }

  const url = `${GEMINI_BASE}/models/${encodeURIComponent(GEMINI_IMAGE_MODEL)}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: finalPrompt }],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch((e) => { console.warn("Failed to read error body", e); return ""; });
    throw new Error(
      `Gemini image generation failed (${res.status}): ${errBody.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { mimeType?: string; data?: string };
          text?: string;
        }>;
      };
    }>;
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  let b64: string | undefined;
  let mimeType = "image/png";
  for (const p of parts) {
    if (p.inlineData?.data) {
      b64 = p.inlineData.data;
      if (p.inlineData.mimeType) mimeType = p.inlineData.mimeType;
      break;
    }
  }
  if (!b64) {
    throw new Error(
      "Gemini image generation failed: no inlineData in response (model may have replied with text-only)",
    );
  }

  const { prisma } = await import("@/lib/prisma");
  const record = await prisma.auditEvent.create({
    data: {
      actor: "nick-image-gen",
      eventType: "generated_image",
      detail: cappedPrompt.slice(0, 200),
      payload: {
        base64: b64,
        model: GEMINI_IMAGE_MODEL,
        size: sizeHint ?? "1024x1024",
        mimeType,
        createdAt: new Date().toISOString(),
        provider: "gemini",
      },
    },
  });

  void import("@/lib/brain/photo-embedding")
    .then((m) =>
      m.embedPhoto({
        photoId: record.id,
        imageUrl: `/api/images/${record.id}`,
        description: cappedPrompt,
      }),
    )
    .catch((err) => {
      void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.gemini-image", err, { fn: "generateGeminiImage.embedPhoto" })).catch((e) => console.error("gemini-image import error", e));
    });

  return {
    base64: b64,
    dataUrl: `data:${mimeType};base64,${b64}`,
    imageUrl: `/api/images/${record.id}`,
    imageId: record.id,
    prompt: cappedPrompt,
    model: GEMINI_IMAGE_MODEL,
    size: sizeHint ?? "1024x1024",
  };
}

export async function generateImageOpenRouter(
  prompt: string,
  options: GeminiImageOptions = {}
): Promise<ImageResult> {
  const openRouterKey = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!openRouterKey) {
    throw new Error("OpenRouter image generation skipped: OPENROUTER_API_KEY not configured");
  }

  const safePrompt = (prompt ?? "").trim();
  const cappedPrompt = safePrompt.length > 2000 ? safePrompt.slice(0, 2000) : safePrompt;
  const sizeHint = options.size || "1024x1024";

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openRouterKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-3.1-flash-image",
      messages: [{ role: "user", content: cappedPrompt }],
      modalities: ["image"],
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch((e) => { console.warn("Failed to read OpenRouter error body", e); return ""; });
    throw new Error(`OpenRouter image generation failed (${res.status}): ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url || data.choices?.[0]?.message?.content;
  if (!imageUrl) {
    throw new Error("OpenRouter image generation failed: no image URL in response");
  }

  let b64: string;
  let mimeType = "image/png";

  if (imageUrl.startsWith("data:")) {
    const matches = imageUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (matches) {
      mimeType = matches[1];
      b64 = matches[2];
    } else {
      throw new Error("Invalid base64 URL format from OpenRouter");
    }
  } else {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      throw new Error(`Failed to fetch image from OpenRouter URL: ${imageUrl}`);
    }
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    b64 = buffer.toString("base64");
    const contentMime = imgRes.headers.get("content-type");
    if (contentMime) mimeType = contentMime;
  }

  const { prisma } = await import("@/lib/prisma");
  const record = await prisma.auditEvent.create({
    data: {
      actor: "nick-image-gen",
      eventType: "generated_image",
      detail: cappedPrompt.slice(0, 200),
      payload: {
        base64: b64,
        model: "google/gemini-3.1-flash-image",
        size: sizeHint,
        mimeType,
        createdAt: new Date().toISOString(),
        provider: "openrouter",
      },
    },
  });

  void import("@/lib/brain/photo-embedding")
    .then((m) =>
      m.embedPhoto({
        photoId: record.id,
        imageUrl: `/api/images/${record.id}`,
        description: cappedPrompt,
      }),
    )
    .catch((err) => {
      void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.gemini-image", err, { fn: "generateImageOpenRouter.embedPhoto" })).catch((e) => console.error("gemini-image import error", e));
    });

  return {
    base64: b64,
    dataUrl: `data:${mimeType};base64,${b64}`,
    imageUrl: `/api/images/${record.id}`,
    imageId: record.id,
    prompt: cappedPrompt,
    model: "google/gemini-3.1-flash-image",
    size: sizeHint,
  };
}

export async function generateImageWithFallback(
  prompt: string,
  options: {
    size?: AcceptedSize;
    autoAspect?: boolean;
  } = {},
): Promise<ImageResult> {
  if (process.env.REPLICATE_FLUX === "true" && process.env.REPLICATE_API_KEY) {
    try {
      const { generateReplicateFluxImage } = await import("./replicate-flux");
      const sizeStr = options.size ?? (options.autoAspect !== false ? inferAspectRatio(prompt) : "1024x1024");
      const [wStr, hStr] = sizeStr.split("x");
      const width = Math.max(256, Math.min(1792, Number(wStr) || 1024));
      const height = Math.max(256, Math.min(1792, Number(hStr) || 1024));
      return await generateReplicateFluxImage(prompt, { width, height });
    } catch (err) {
      console.warn(
        `[ai:image] Replicate FLUX failed · falling back to direct Gemini: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const size = options.size ?? (options.autoAspect !== false ? inferAspectRatio(prompt) : "1024x1024");
  try {
    return await generateGeminiImage(prompt, { ...options, size });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ai:image] Direct Gemini failed (${msg.slice(0, 120)}) · trying OpenRouter fallback`);
    try {
      return await generateImageOpenRouter(prompt, { ...options, size });
    } catch (orErr) {
      const orMsg = orErr instanceof Error ? orErr.message : String(orErr);
      throw new Error(`Both Direct Gemini and OpenRouter failed. Gemini error: ${msg}. OpenRouter error: ${orMsg}`);
    }
  }
}
