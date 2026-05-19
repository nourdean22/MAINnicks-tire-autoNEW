/**
 * lib/services/image-actions.ts · Phase II (2026-05-18 PM)
 *
 * Two image-action services for the NickMessage hover overlay:
 *   · upscaleImage · re-renders the source at 2x or 4x via Venice
 *     upscale
 *   · varyImage    · pulls the original prompt + re-runs Venice
 *     generate N times with new seeds for A/B variants
 *
 * Extracted from `app/api/images/upscale/route.ts` and
 * `app/api/images/variations/route.ts` so the legacy REST endpoints
 * AND the new `trpc.chat.upscaleImage` + `trpc.chat.varyImage`
 * mutations both call these single functions · drift between the
 * two consumers is structurally impossible. Same shared-service
 * pattern as S.2 / U.3 / Y.1 / Z / DD / EE / GG / HH.
 *
 * Cost tracking via `trackGeneration()` is preserved verbatim so the
 * /system/ai-cost dashboard sees the spend regardless of which
 * caller path triggered the gen.
 */

import { prisma } from "@/lib/prisma";
import {
  upscaleVeniceImage,
  generateVeniceImage,
  type UpscaleScale,
} from "@/lib/ai/venice-image";
import { trackGeneration } from "@/lib/ai/track";

export interface UpscaleArgs {
  sourceImageId: string;
  scale: UpscaleScale;
  enhance?: boolean;
}

export interface UpscaleResult {
  ok: true;
  imageUrl: string;
  imageId: string;
  size: string;
  scale: UpscaleScale;
  sourceImageId: string;
  durationMs: number;
  costCents: number;
}

export async function upscaleImage(args: UpscaleArgs): Promise<UpscaleResult> {
  const t0 = Date.now();
  try {
    const result = await upscaleVeniceImage(args.sourceImageId, args.scale, {
      enhance: args.enhance ?? true,
    });
    const durationMs = Date.now() - t0;

    // Cost tracking — flat per-call estimate. Venice's actual price is
    // metered server-side; we approximate so the cost dashboard sees
    // the spend in real time. 2x ≈ $0.02 = 2¢, 4x ≈ $0.04 = 4¢.
    void trackGeneration({
      feature: "image_upscale",
      model: "venice-upscale",
      promptTokens: args.scale === 4 ? 40_000 : 20_000,
      outputTokens: 0,
      durationMs,
      status: "complete",
    });

    return {
      ok: true,
      imageUrl: result.imageUrl,
      imageId: result.imageId,
      size: result.size,
      scale: result.scale,
      sourceImageId: result.sourceImageId,
      durationMs,
      costCents: args.scale === 4 ? 4 : 2,
    };
  } catch (err) {
    // Track the failure so the cost dashboard's error rate is real
    void trackGeneration({
      feature: "image_upscale",
      model: "venice-upscale",
      durationMs: Date.now() - t0,
      status: "error",
    });
    throw err;
  }
}

export interface VaryArgs {
  sourceImageId: string;
  count?: number;
  /** Optional speed override · "fast" (z-image-turbo) for cheap variants */
  speed?: "fast" | "balanced" | "quality";
}

export interface VariantImage {
  imageUrl: string;
  imageId: string;
  model: string;
  size: string;
}

export interface VaryResult {
  ok: true;
  sourceImageId: string;
  count: number;
  failed: number;
  durationMs: number;
  images: VariantImage[];
}

/** Thrown when the sourceImageId doesn't resolve to an AuditEvent.
 *  Procedure callers translate to NOT_FOUND · REST handler to 404. */
export class SourceImageNotFoundError extends Error {
  constructor(sourceImageId: string) {
    super(`source_not_found: ${sourceImageId}`);
    this.name = "SourceImageNotFoundError";
  }
}

type SourceSize = "512x512" | "1024x1024" | "1536x1024" | "1024x1536";

export async function varyImage(args: VaryArgs): Promise<VaryResult> {
  const count = Math.max(1, Math.min(4, args.count ?? 2));

  // Pull the original prompt + size from the source image record
  const source = await prisma.auditEvent.findUnique({
    where: { id: args.sourceImageId },
    select: { detail: true, payload: true },
  });
  if (!source) throw new SourceImageNotFoundError(args.sourceImageId);

  const sourcePayload = source.payload as { size?: string };
  const originalPrompt = source.detail ?? "(no prompt available)";
  // v10.0.479 · size enum updated to flux-2-pro accepted values.
  // Legacy DB rows may still hold "1024x768" / "768x1024" · map them
  // to the closest new shape so variations of older images don't 400.
  const rawSize = sourcePayload.size ?? "1024x1024";
  const sourceSize: SourceSize =
    rawSize === "1024x768"
      ? "1536x1024"
      : rawSize === "768x1024"
        ? "1024x1536"
        : ["512x512", "1024x1024", "1536x1024", "1024x1536"].includes(rawSize)
          ? (rawSize as SourceSize)
          : "1024x1024";

  // Generate variations in parallel — Venice can handle ~3-4 concurrent
  // image gens for the same key without rate-limiting issues.
  const t0 = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: count }, () =>
      generateVeniceImage(originalPrompt, {
        size: sourceSize,
        speed: args.speed ?? "fast",
      }),
    ),
  );

  const successes = results
    .filter(
      (r): r is PromiseFulfilledResult<
        Awaited<ReturnType<typeof generateVeniceImage>>
      > => r.status === "fulfilled",
    )
    .map((r) => r.value);
  const failures = results.filter((r) => r.status === "rejected").length;

  // Track each successful gen for cost dashboard visibility
  for (const r of successes) {
    void trackGeneration({
      feature: "image_variation",
      model: r.model,
      promptTokens: r.model === "z-image-turbo" ? 10_000 : 50_000,
      outputTokens: 0,
      durationMs: Math.round((Date.now() - t0) / count),
      status: "complete",
    });
  }

  if (failures > 0) {
    void trackGeneration({
      feature: "image_variation",
      model: "venice-image",
      durationMs: Date.now() - t0,
      status: "error",
    });
  }

  return {
    ok: true,
    sourceImageId: args.sourceImageId,
    count: successes.length,
    failed: failures,
    durationMs: Date.now() - t0,
    images: successes.map((r) => ({
      imageUrl: r.imageUrl,
      imageId: r.imageId,
      model: r.model,
      size: r.size,
    })),
  };
}
