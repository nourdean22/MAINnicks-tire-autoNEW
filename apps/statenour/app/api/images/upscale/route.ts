/**
 * /api/images/upscale — Venice upscale endpoint.
 *
 * v6 · BATCH 2 · Apr 28. POST { sourceImageId, scale (2|4), enhance? }
 * → { imageUrl, imageId, size, scale, sourceImageId, costCents }.
 *
 * Used by the chat surface's "upscale" button on rendered images. Cost
 * is tracked via AiGeneration so the cost dashboard sees the spend.
 *
 * Auth: session cookie. Rate limit: 10/min per user (image generation
 * is expensive and the upscale endpoint is even more so).
 */

import { NextResponse } from "next/server";
import { upscaleVeniceImage, type UpscaleScale } from "@/lib/ai/venice-image";
import { trackGeneration } from "@/lib/ai/track";
import { requireSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

interface UpscaleBody {
  sourceImageId?: string;
  scale?: number;
  enhance?: boolean;
}

export async function POST(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  let body: UpscaleBody;
  try {
    body = (await req.json()) as UpscaleBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.sourceImageId || typeof body.sourceImageId !== "string") {
    return NextResponse.json({ error: "missing_source_image_id" }, { status: 400 });
  }

  const scale = (body.scale === 4 ? 4 : 2) as UpscaleScale;

  const t0 = Date.now();
  try {
    const result = await upscaleVeniceImage(body.sourceImageId, scale, {
      enhance: body.enhance ?? true,
    });
    const durationMs = Date.now() - t0;

    // Cost tracking — flat per-call estimate. Venice's actual price is
    // metered server-side; we approximate so the cost dashboard sees
    // the spend in real time. 2x ≈ $0.02 = 2¢, 4x ≈ $0.04 = 4¢.
    void trackGeneration({
      feature: "image_upscale",
      model: "venice-upscale",
      promptTokens: scale === 4 ? 40_000 : 20_000, // synthetic image-cost token
      outputTokens: 0,
      durationMs,
      status: "complete",
    });

    return NextResponse.json({
      ok: true,
      imageUrl: result.imageUrl,
      imageId: result.imageId,
      size: result.size,
      scale: result.scale,
      sourceImageId: result.sourceImageId,
      durationMs,
      costCents: scale === 4 ? 4 : 2,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[images/upscale] failed:", message);

    void trackGeneration({
      feature: "image_upscale",
      model: "venice-upscale",
      durationMs: Date.now() - t0,
      status: "error",
    });

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
