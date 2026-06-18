/**
 * Replicate FLUX Image Generation
 *
 * Category 8 of apps/nickstire/docs/eval-rubrics/huggingface-model-strategy.md.
 * Self-hosted FLUX via Replicate as a 20× cheaper alternative to
 * Venice's flux-2-pro:
 *
 *   - Venice flux-2-pro:  $0.04/img
 *   - Replicate flux-schnell: $0.003/img (12× cheaper · 4-step distilled)
 *   - Replicate flux-dev:      $0.025/img (similar to Venice · highest quality)
 *
 * Same input/output shape as `generateVeniceImage` (returns `ImageResult`
 * with base64 + dataUrl). The Venice wrapper checks REPLICATE_FLUX env
 * flag and delegates here when ON; otherwise the Venice path runs
 * unchanged.
 *
 * Replicate returns image URLs · this module fetches the URL and
 * base64-encodes the response so the consumer-side interface matches
 * Venice's b64_json shape.
 */

import type { ImageResult } from "./gemini-image";

const REPLICATE_API_BASE = "https://api.replicate.com/v1";

// Replicate model versions. Pin to a specific hash for reproducibility ·
// re-check Replicate model page if quality regresses.
const FLUX_SCHNELL_VERSION = "bf412d2c8f7ed01ba7c9aff36e3f3bbf6fbf7c43c3e8f78f2a1ec03ab9b3a6f7";
// ^ flux-schnell · 4 inference steps · ~1-2s per image · default
const FLUX_DEV_VERSION = "27b93a2413e7f36cd83da1a85ed1e2dffa8ba38b27e54f9c1c2fc70d52d8a82c";
// ^ flux-dev · 28 inference steps · ~4-6s per image · higher quality

export interface ReplicateFluxOptions {
  /** Override model · "flux-schnell" (default · fast/cheap) | "flux-dev" (quality) */
  model?: "flux-schnell" | "flux-dev";
  /** Image dimensions. Replicate accepts width + height (multiples of 16). */
  width?: number;
  height?: number;
  /** Number of inference steps. flux-schnell defaults 4 · flux-dev defaults 28. */
  numInferenceSteps?: number;
  /** Replicate "guidance" param · default 3.5 (matches FLUX paper) */
  guidance?: number;
  /** Optional seed for reproducibility */
  seed?: number;
  /** Optional timeout · default 60s */
  timeoutMs?: number;
}

/**
 * Generate an image via Replicate FLUX. Returns the same ImageResult
 * shape as generateVeniceImage so existing callers don't need to
 * change.
 *
 * Throws on failure (Replicate HTTP error, image fetch failure, etc.).
 * Caller should wrap in try/catch and decide whether to fall back to
 * Venice OR surface the error.
 */
export async function generateReplicateFluxImage(
  prompt: string,
  options: ReplicateFluxOptions = {},
): Promise<ImageResult> {
  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) {
    throw new Error("REPLICATE_API_KEY not set · cannot use Replicate FLUX backend");
  }

  const modelName = options.model ?? (process.env.REPLICATE_FLUX_MODEL as "flux-schnell" | "flux-dev" | undefined) ?? "flux-schnell";
  const width = options.width ?? 1024;
  const height = options.height ?? 1024;
  const numSteps = options.numInferenceSteps ?? (modelName === "flux-schnell" ? 4 : 28);
  const guidance = options.guidance ?? 3.5;
  const timeoutMs = options.timeoutMs ?? 60_000;

  const version =
    modelName === "flux-schnell"
      ? (process.env.REPLICATE_FLUX_SCHNELL_VERSION ?? FLUX_SCHNELL_VERSION)
      : (process.env.REPLICATE_FLUX_DEV_VERSION ?? FLUX_DEV_VERSION);

  const safePrompt = (prompt ?? "").trim();
  if (!safePrompt) throw new Error("Replicate FLUX: empty prompt");

  // Step 1 · Create prediction with sync-wait for fast paths
  const createResp = await fetch(`${REPLICATE_API_BASE}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({
      version,
      input: {
        prompt: safePrompt,
        width,
        height,
        num_inference_steps: numSteps,
        guidance,
        ...(options.seed ? { seed: options.seed } : {}),
        output_format: "png",
        disable_safety_checker: false,
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!createResp.ok) {
    const errText = await createResp.text().catch(() => "");
    throw new Error(`Replicate HTTP ${createResp.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await createResp.json()) as {
    id: string;
    status: string;
    output?: string | string[];
    error?: string;
  };

  if (data.error) throw new Error(`Replicate error: ${data.error}`);

  let imageUrl = pickFirstUrl(data.output);

  // Step 2 · Poll if not ready yet
  if (!imageUrl && data.id) {
    const pollDeadline = Date.now() + timeoutMs;
    while (Date.now() < pollDeadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const pollResp = await fetch(`${REPLICATE_API_BASE}/predictions/${data.id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!pollResp.ok) continue;
      const pollData = (await pollResp.json()) as {
        status: string;
        output?: string | string[];
        error?: string;
      };
      if (pollData.error) throw new Error(`Replicate error: ${pollData.error}`);
      if (pollData.status === "succeeded") {
        imageUrl = pickFirstUrl(pollData.output);
        if (imageUrl) break;
      }
      if (pollData.status === "failed" || pollData.status === "canceled") {
        throw new Error(`Replicate prediction ${pollData.status}`);
      }
    }
  }

  if (!imageUrl) throw new Error("Replicate FLUX returned no image URL");

  // Step 3 · Fetch image, base64-encode to match Venice's response shape
  const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
  if (!imgResp.ok) {
    throw new Error(`Replicate image fetch failed: ${imgResp.status} ${imageUrl}`);
  }
  const buf = await imgResp.arrayBuffer();
  const base64 = Buffer.from(buf).toString("base64");
  const mimeType = imgResp.headers.get("content-type") ?? "image/png";
  const dataUrl = `data:${mimeType};base64,${base64}`;

  return {
    base64,
    dataUrl,
    imageUrl, // operator can use the direct URL while it's valid (~1hr Replicate retention)
    imageId: data.id,
    prompt: safePrompt,
    model: `replicate:${modelName}`,
    size: `${width}x${height}`,
  };
}

function pickFirstUrl(output: string | string[] | undefined): string | null {
  if (!output) return null;
  if (typeof output === "string") return output;
  if (Array.isArray(output) && output.length > 0 && typeof output[0] === "string") return output[0];
  return null;
}

export function isReplicateFluxEnabled(): boolean {
  return process.env.REPLICATE_FLUX === "true" && Boolean(process.env.REPLICATE_API_KEY);
}
