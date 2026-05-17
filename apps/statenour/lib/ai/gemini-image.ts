/**
 * lib/ai/gemini-image.ts · v10.0.529.47
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
 *
 * The returned ImageResult shape matches lib/ai/venice-image.ts so
 * downstream callers (tools.ts · interceptors.ts) can swap the
 * implementation without changes. Persistence path is identical:
 * AuditEvent(eventType="generated_image") stores the base64, and
 * the relative URL /api/images/<recordId> serves it.
 *
 * Skills consulted:
 *   · ai-studio-image (Google AI Studio image patterns)
 *   · error-handling-patterns (provider-chain fallback discipline)
 *   · api-endpoint-builder (clean REST contract)
 *   · kaizen + karpathy-guidelines (smallest surgical add)
 */

import type { ImageResult } from "./venice-image";

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
// `gemini-2.5-flash-image` is the production model · the rebrand of
// nano-banana. `gemini-2.0-flash-exp` is the older preview that also
// supports image output but is being deprecated.
const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

/**
 * Native Gemini sizes · always 1024x1024 from the model. We accept
 * the same string enum as Venice so the upstream caller doesn't
 * have to switch types · we just return "1024x1024" regardless.
 */
type AcceptedSize = "512x512" | "1024x1024" | "1536x1024" | "1024x1536";

export interface GeminiImageOptions {
  size?: AcceptedSize;
  /** Output prompt-string passthrough · used for AuditEvent detail + caller's record. */
  recordedPrompt?: string;
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
  // The model handles long prompts fine, but cap to a sane limit for
  // request-size hygiene + audit-record cleanliness.
  const cappedPrompt =
    safePrompt.length > 2000 ? safePrompt.slice(0, 2000) : safePrompt;

  // Aspect-ratio hint · the model uses prompt-tail guidance instead
  // of a structured param. Append a light directional cue when the
  // caller passed a non-square size · we don't override the model's
  // judgment, just nudge it.
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
      // Both header AND query-param auth are accepted · header is
      // preferred so the key doesn't end up in HTTP logs.
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: finalPrompt }],
        },
      ],
      // generationConfig is optional · the model defaults to outputting
      // an image when the prompt is image-asking. Explicit responseModalities
      // pinning ensures the output includes image data.
      generationConfig: {
        responseModalities: ["IMAGE"],
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
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

  // Walk parts for the first image · text parts can sneak in if the
  // model produced commentary alongside the image, ignore them.
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

  // Persist · same AuditEvent shape Venice uses so /api/images/<id>
  // serves either-source images identically.
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

  // Fire-and-forget photo embedding · matches Venice path. Skips
  // qwen3-vl by passing the prompt as the description.
  void import("@/lib/brain/photo-embedding")
    .then((m) =>
      m.embedPhoto({
        photoId: record.id,
        imageUrl: `/api/images/${record.id}`,
        description: cappedPrompt,
      }),
    )
    .catch(() => {
      // Embedding is enrichment · failure doesn't break the image.
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

/**
 * Provider-chain helper · try Venice first, fall through to Gemini
 * on 402 (no credit) · 429 (rate limit) · or any network/5xx error.
 * Bubbles up the LAST error if both fail so the caller still sees
 * a useful message.
 *
 * Other error classes (400 validation · 401 auth) skip Venice entirely
 * because they're prompt-shape issues that Gemini can't fix either.
 */
export async function generateImageWithFallback(
  prompt: string,
  options: {
    size?: AcceptedSize;
    autoAspect?: boolean;
  } = {},
): Promise<ImageResult> {
  const { generateVeniceImage } = await import("./venice-image");
  try {
    return await generateVeniceImage(prompt, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Decide whether to fall through · only on quota/billing/server
    // failures. Validation/auth errors stay loud · they need a fix
    // at the prompt or env level, not a provider swap.
    const shouldFallThrough =
      /\b(402\b|payment|insufficient|credit|429\b|rate.?limit|too.?many|5\d\d\b|server|timeout|ECONNRESET|fetch)\b/i.test(
        msg,
      );
    if (!shouldFallThrough) throw err;
    console.warn(
      `[ai:image] Venice failed (${msg.slice(0, 120)}) · falling through to Gemini`,
    );
    return await generateGeminiImage(prompt, options);
  }
}
