/**
 * Venice AI Image Generation
 *
 * Uses Venice's OpenAI-compatible image generation API.
 * Returns base64-encoded images — no filesystem writes needed (Vercel-safe).
 *
 * Apr 27 v3 · Default model swapped from nano-banana-2 (photoreal, 25-30s)
 * to recraft-v4 (graphic-design quality, 10-12s, best-in-class text
 * rendering). Nour wanted "less realism, more post quality" — recraft is
 * purpose-built for marketing graphics, banners, Instagram posts.
 *
 * Sizes: 512x512 (default, fastest), 1024x1024, 1024x768, 768x1024
 *
 * Available Venice image models (Apr 27 model list):
 *   · recraft-v4 (DEFAULT) — graphic design, text rendering, $0.05
 *   · z-image-turbo — fastest (8 steps, ~4-6s), $0.01
 *   · flux-2-pro — modern Flux, good for text, $0.04
 *   · seedream-v4 — sharp post-friendly output, $0.05
 *   · nano-banana-2 — photorealistic (slower), former default
 *   · qwen-image — fast & design-y, 8 steps, $0.01
 */

const VENICE_BASE = "https://api.venice.ai/api/v1";

// Per-prompt model override is supported via the `model` option, but the
// default below is the smart pick for Nour's content workflow.
// v10.0.477 · default model swapped recraft-v4 → flux-2-pro:
//   · flux-2-pro is the more recent Venice offering ($0.04/img vs
//     recraft's $0.05) with strong text rendering + Flux-class coherence
//     — a step up from recraft-v4's "graphic-design but text often
//     broken" failure that drove the v10.0.333 OpenAI switch.
//   · Operator wants Venice for cost (gpt-image-1 was $0.19-0.25/img),
//     and flux-2-pro is the most recent + cheapest Venice option.
//   · Speed-mode keywords still route to seedream-v4 ("quality") and
//     recraft-v4 ("balanced"); flux-2-pro is the no-keyword default.
const DEFAULT_IMAGE_MODEL = "flux-2-pro";

// Apr 28 v6 · ASPECT-RATIO INFERENCE
// Detect format hints in the user prompt and pick the right canvas.
// Instagram feed = 4:5 portrait, Story/Reel = 9:16, billboards/banners
// = 16:9, square fallback = 1:1. Saves a manual size override per ask.
//
// Returns the recommended Venice size string. Default = 1024x1024 (square)
// when no format keywords detected.
//
// v10.0.479 · sizes updated to flux-2-pro's accepted enum. The previous
// 1024x768 / 768x1024 sizes were rejected by flux-2-pro with a 400
// validation error. Venice's flux-2-pro accepts: 256x256 · 512x512 ·
// 1024x1024 · 1024x1536 · 1536x1024 · 1024x1792 · 1792x1024 · auto.
// Updated landscape → 1536x1024 · portrait → 1024x1536 to match.
// Old recraft-v4 / seedream-v4 also accept these wider sizes (per
// the model-version compatibility matrix in Venice's API docs).
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

function getKey(): string {
  const key = process.env.VENICE_API_KEY;
  if (!key) throw new Error("VENICE_API_KEY not set");
  return key;
}

export interface ImageResult {
  base64: string;
  dataUrl: string;
  imageUrl: string;
  imageId: string;
  prompt: string;
  model: string;
  size: string;
}

// v6 · BATCH 2 · Apr 28 — Speed mode picker.
// Maps a simple "fast / balanced / quality" preference to the right
// Venice model. Lets callers say "I want this NOW" or "I want the
// nicest version" without knowing the model catalog.
//
// fast (z-image-turbo): ~4-6s, $0.01/img, 8 steps. For drafts, A/B,
//   batch generation, internal previews.
// balanced (recraft-v4): ~10-12s, $0.05/img, graphic-design quality.
//   DEFAULT — the everyday workhorse for marketing posts.
// quality (seedream-v4): ~15-20s, $0.05/img, sharpest text + post-friendly.
//   Use when the asset is going to a paid ad or a billboard.
export type ImageSpeedMode = "fast" | "balanced" | "quality";

// v10.0.479 · operator wants flux-2-pro to actually be the default, not
// silently downgraded to seedream-v4 ($0.05) when the brand-context
// synth injects "billboard quality" / "premium" / "magazine quality"
// keywords that trip inferSpeedMode → "quality". Mapping balanced +
// quality to flux-2-pro keeps the cost-effective Flux model in play
// regardless of prompt phrasing. Explicit /turbo still routes to
// z-image-turbo when speed beats fidelity matters.
const SPEED_MODE_MODELS: Record<ImageSpeedMode, string> = {
  fast: "z-image-turbo",
  balanced: "flux-2-pro",
  quality: "flux-2-pro",
};

/**
 * Detect speed-mode keywords in the prompt and pick the matching model.
 * Returns null when no keywords are present so caller can fall back to
 * its own default. Used by the chat interceptor to honor "/turbo" or
 * "fast image" or "high quality" in user requests.
 */
export function inferSpeedMode(prompt: string): ImageSpeedMode | null {
  if (!prompt) return null;
  const p = prompt.toLowerCase();
  // Quality hints — explicit asks for the nicest output
  if (/\b(highest\s+quality|max\s+quality|best\s+quality|premium|paid\s+ad|billboard\s+quality|magazine\s+quality)\b/.test(p)) {
    return "quality";
  }
  // Fast hints — drafts, batch, previews, /turbo slash. \bturbo\b also
  // catches "/turbo" because `/` is a non-word boundary char.
  if (/\b(turbo|fast|quick|draft|preview|rough|sketch|cheap)\b/.test(p)) {
    return "fast";
  }
  return null; // no opinion — caller decides
}

/**
 * Generate an image using Venice AI.
 * Returns base64 data and a data URL ready for display.
 */
export async function generateVeniceImage(
  prompt: string,
  options: {
    // v10.0.479 · sizes updated to match flux-2-pro accepted enum
    size?: "512x512" | "1024x1024" | "1536x1024" | "1024x1536";
    model?: string;
    /** v6 · auto-pick aspect ratio from prompt keywords if size is undefined */
    autoAspect?: boolean;
    /** v6 · BATCH 2 · explicit speed-mode override (fast/balanced/quality) */
    speed?: ImageSpeedMode;
  } = {}
): Promise<ImageResult> {
  // Wave AJ · Cat 8 HF strategy · Replicate FLUX backend
  // When REPLICATE_FLUX=true (and REPLICATE_API_KEY set), route image
  // generation through Replicate's flux-schnell (~$0.003/img) instead
  // of Venice flux-2-pro ($0.04/img) · ~12-20x cheaper at comparable
  // quality. Same return shape so callers don't need to change.
  // Falls back to Venice if Replicate throws. See:
  //   apps/statenour/lib/ai/replicate-flux.ts
  //   apps/statenour/docs/runbooks/replicate-flux-cutover.md
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
        `[venice-image] Replicate FLUX failed · falling back to Venice: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Fall through to Venice path below
    }
  }

  // v6 · Auto-aspect: when size isn't explicitly set, infer from prompt
  // (story → 9:16, instagram → 4:5, billboard → 16:9, default → 1:1).
  // Caller can pass autoAspect=false to force the 512×512 default.
  const size = options.size
    ?? (options.autoAspect !== false ? inferAspectRatio(prompt) : "512x512");
  // Model resolution priority: explicit `model` > speed-mode override >
  // inferred speed mode from prompt > default.
  const inferredSpeed = inferSpeedMode(prompt);
  const speed = options.speed ?? inferredSpeed;
  const model =
    options.model
    ?? (speed ? SPEED_MODE_MODELS[speed] : DEFAULT_IMAGE_MODEL);

  // v7 · Apr 28 hotfix · PROMPT-LENGTH GUARD.
  // Venice rejects prompts > 1500 chars with a 400 + Zod-shaped error
  // (`{"details":{"prompt":{"_error":"..."}}}`). Synthesizer can produce
  // long prompts when prior context is rich. Cap at 1400 to leave headroom.
  // Also reject empty/whitespace-only prompts upfront — Venice 400s on those.
  const VENICE_PROMPT_MAX = 1400;
  let safePrompt = (prompt ?? "").trim();
  if (!safePrompt) {
    throw new Error("Venice image generation failed: empty prompt (synthesizer returned nothing usable)");
  }
  if (safePrompt.length > VENICE_PROMPT_MAX) {
    safePrompt = safePrompt.slice(0, VENICE_PROMPT_MAX).replace(/[\s,;.]+\S*$/, ""); // trim mid-word
    console.warn(
      `[venice-image] prompt truncated ${prompt.length} → ${safePrompt.length} chars (Venice limit ~1500)`,
    );
  }

  const res = await fetch(`${VENICE_BASE}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getKey()}`,
    },
    body: JSON.stringify({
      model,
      prompt: safePrompt,
      size,
      response_format: "b64_json",
      n: 1,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    // v7 · Apr 28 · Parse Venice's structured 400 errors so we surface
    // the actual rejection reason instead of generic "rate-limited".
    let detail = err;
    let kind: "rate_limit" | "validation" | "auth" | "server" | "unknown" = "unknown";
    if (res.status === 429) kind = "rate_limit";
    else if (res.status === 401 || res.status === 403) kind = "auth";
    else if (res.status >= 500) kind = "server";
    else if (res.status === 400 || res.status === 422) {
      kind = "validation";
      // Try to extract the Zod-style error message. Venice returns
      //   { details: { fieldName: { _errors: [...] } } }
      // for ANY field, not just prompt. Walk all fields to find the
      // first concrete error message + name the offending field.
      try {
        const parsed = JSON.parse(err) as {
          error?: string;
          details?: Record<string, { _error?: string; _errors?: string[] } | unknown> & { _errors?: string[] };
        };
        if (parsed.details && typeof parsed.details === "object") {
          for (const [field, val] of Object.entries(parsed.details)) {
            if (field === "_errors") continue;
            const fieldErr = val as { _error?: string; _errors?: string[] } | null;
            if (fieldErr?._error) {
              detail = `${field} rejected: ${fieldErr._error}`;
              break;
            }
            if (Array.isArray(fieldErr?._errors) && fieldErr._errors.length > 0) {
              detail = `${field} rejected: ${fieldErr._errors[0]}`;
              break;
            }
          }
          if (detail === err && parsed.details._errors?.length) {
            detail = `request rejected: ${parsed.details._errors[0]}`;
          }
        } else if (parsed.error) {
          detail = parsed.error;
        }
      } catch {
        // Use raw err text
      }
    }
    throw new Error(
      `Venice image generation failed (${res.status} ${kind}): ${detail.slice(0, 300)}`,
    );
  }

  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;

  if (!b64) throw new Error("No image data returned from Venice");

  // Store in DB so we can serve via URL instead of stuffing base64 into tool result
  const { prisma } = await import("@/lib/prisma");
  const record = await prisma.auditEvent.create({
    data: {
      actor: "nick-image-gen",
      eventType: "generated_image",
      detail: prompt.slice(0, 200),
      payload: { base64: b64, model, size, createdAt: new Date().toISOString() },
    },
  });

  // v10.0.94 · auto-embed photo on creation. Fire-and-forget so
  // user-facing latency stays the same. Pass `description: prompt`
  // so we skip the qwen3-vl vision call — the prompt IS the
  // description we'd want anyway, and it costs $0.
  void import("@/lib/brain/photo-embedding")
    .then((m) =>
      m.embedPhoto({
        photoId: record.id,
        imageUrl: `/api/images/${record.id}`,
        description: prompt,
      }),
    )
    .catch(() => {
      // Photo embedding is enrichment, not core. If it fails the
      // image is still served + AuditEvent persisted.
    });

  // RELATIVE URL (Apr 15 fix): previously we built an absolute URL
  // using VERCEL_PROJECT_PRODUCTION_URL or a hardcoded bdnick.info.
  // That broke on preview deployments (image generated under the
  // preview host but URL pointed to prod, which 404'd because the
  // record didn't exist there) and broke locally too. Relative URLs
  // are resolved by the browser against the current origin, so the
  // image ALWAYS loads from whatever deployment served the chat.
  return {
    base64: b64,
    dataUrl: `data:image/png;base64,${b64}`,
    imageUrl: `/api/images/${record.id}`,
    imageId: record.id,
    prompt,
    model,
    size,
  };
}

// v6 · BATCH 2 · Apr 28 — IMAGE UPSCALE
// Venice exposes /image/upscale taking a source image (base64 or URL) +
// scale factor (2 or 4). Returns a higher-res version with optional AI
// enhancement. Useful for billboard prints or HD social posts where the
// 1024×1024 max from generation isn't enough.
//
// Pricing: ~$0.02 per upscale (2x) / ~$0.04 (4x). Worth it when the
// source is a winner — beats re-rolling a 4K render.
//
// Returns an ImageResult shaped exactly like generateVeniceImage so
// the caller can swap them. The new image gets its own auditEvent row
// and its own /api/images/:id URL.
export type UpscaleScale = 2 | 4;

export interface UpscaleResult extends ImageResult {
  sourceImageId: string;
  scale: UpscaleScale;
}

export async function upscaleVeniceImage(
  sourceImageId: string,
  scale: UpscaleScale = 2,
  options: {
    /** Optional creative-enhance flag — adds AI detail rather than just larger pixels */
    enhance?: boolean;
  } = {},
): Promise<UpscaleResult> {
  const { prisma } = await import("@/lib/prisma");

  // Pull source base64 from auditEvent
  const source = await prisma.auditEvent.findUnique({
    where: { id: sourceImageId },
    select: { payload: true, detail: true },
  });
  if (!source?.payload) {
    throw new Error(`source image ${sourceImageId} not found`);
  }
  const payload = source.payload as { base64?: string; size?: string };
  if (!payload.base64) {
    throw new Error(`source image ${sourceImageId} has no base64 payload`);
  }

  const res = await fetch(`${VENICE_BASE}/image/upscale`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getKey()}`,
    },
    body: JSON.stringify({
      image: `data:image/png;base64,${payload.base64}`,
      scale,
      enhance: options.enhance ?? true,
    }),
    signal: AbortSignal.timeout(90_000), // upscale can take 30-60s for 4x
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Venice upscale failed (${res.status}): ${err}`);
  }

  // Venice returns either b64_json (newer endpoints) or url (older).
  // Handle both — normalize to base64 for storage.
  let b64: string | null = null;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.startsWith("application/json")) {
    const data = await res.json();
    b64 = data.data?.[0]?.b64_json ?? data.b64_json ?? null;
    if (!b64 && data.data?.[0]?.url) {
      const fetched = await fetch(data.data[0].url);
      const buf = Buffer.from(await fetched.arrayBuffer());
      b64 = buf.toString("base64");
    }
  } else if (contentType.startsWith("image/")) {
    // Direct binary response
    const buf = Buffer.from(await res.arrayBuffer());
    b64 = buf.toString("base64");
  }

  if (!b64) throw new Error("upscale returned no image data");

  const sourceSize = payload.size ?? "512x512";
  const [w, h] = sourceSize.split("x").map(Number);
  const newSize = `${w * scale}x${h * scale}`;

  // v10.0.94 · upscaled images get the same auto-embed. The
  // `description` here references the source so KNN finds the
  // upscaled version when looking for the original prompt's content.
  const record = await prisma.auditEvent.create({
    data: {
      actor: "nick-image-upscale",
      eventType: "upscaled_image",
      detail: `${sourceImageId} · ${scale}x · ${newSize}`,
      payload: {
        base64: b64,
        model: "venice-upscale",
        size: newSize,
        scale,
        sourceImageId,
        createdAt: new Date().toISOString(),
      },
    },
  });

  // v10.0.104 audit fix · the v10.0.94 comment above promised an
  // auto-embed but the call was never added. Without this, upscaled
  // images don't appear in KNN search even though the originals do.
  // Use source.detail (the original prompt) as the description so the
  // upscaled record indexes the same semantic content.
  void import("@/lib/brain/photo-embedding")
    .then((m) =>
      m.embedPhoto({
        photoId: record.id,
        imageUrl: `/api/images/${record.id}`,
        description: source.detail ?? `upscale ${scale}x of ${sourceImageId}`,
      }),
    )
    .catch(() => {
      // Embedding is enrichment, not core. If it fails the upscaled
      // image is still served + audit row persisted.
    });

  return {
    base64: b64,
    dataUrl: `data:image/png;base64,${b64}`,
    imageUrl: `/api/images/${record.id}`,
    imageId: record.id,
    prompt: source.detail ?? "(upscaled)",
    model: "venice-upscale",
    size: newSize,
    sourceImageId,
    scale,
  };
}
