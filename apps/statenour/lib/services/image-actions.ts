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
  generateImageWithFallback,
} from "@/lib/ai/gemini-image";
import { trackGeneration } from "@/lib/ai/track";

export type UpscaleScale = 2 | 4;

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
  throw new Error("Upscaling is not supported by the current provider (Venice is retired).");
}

export interface VaryArgs {
  sourceImageId: string;
  count?: number;
  /** Optional speed override */
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
  const rawSize = sourcePayload.size ?? "1024x1024";
  const sourceSize: SourceSize =
    rawSize === "1024x768"
      ? "1536x1024"
      : rawSize === "768x1024"
        ? "1024x1536"
        : ["512x512", "1024x1024", "1536x1024", "1024x1536"].includes(rawSize)
          ? (rawSize as SourceSize)
          : "1024x1024";

  const t0 = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: count }, () =>
      generateImageWithFallback(originalPrompt, {
        size: sourceSize,
      }),
    ),
  );

  const successes = results
    .filter(
      (r): r is PromiseFulfilledResult<
        Awaited<ReturnType<typeof generateImageWithFallback>>
      > => r.status === "fulfilled",
    )
    .map((r) => r.value);
  const failures = results.filter((r) => r.status === "rejected").length;

  for (const r of successes) {
    void trackGeneration({
      feature: "image_variation",
      model: r.model,
      promptTokens: 50_000,
      outputTokens: 0,
      durationMs: Math.round((Date.now() - t0) / count),
      status: "complete",
    });
  }

  if (failures > 0) {
    void trackGeneration({
      feature: "image_variation",
      model: "gemini-image",
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
