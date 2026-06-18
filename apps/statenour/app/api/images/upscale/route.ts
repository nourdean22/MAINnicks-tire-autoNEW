/**
 * POST /api/images/upscale — Venice upscale endpoint.
 *
 * v6 · BATCH 2 · Apr 28. POST { sourceImageId, scale (2|4), enhance? }
 * → { imageUrl, imageId, size, scale, sourceImageId, costCents }.
 *
 * Phase II (2026-05-18 PM) · heavy lifting moved to
 * `lib/services/image-actions.upscaleImage` so both this REST endpoint
 * AND the new `trpc.chat.upscaleImage` mutation call the same function
 * · drift between the two consumers is structurally impossible.
 * Stays mounted for back-compat with any non-tRPC consumer.
 *
 * Auth: session cookie. Rate limit: 10/min per user (image gen is
 * expensive · upscale is even more so).
 */

import { NextResponse } from "next/server";
import { upscaleImage } from "@/lib/services/image-actions";
import { requireSession } from "@/lib/auth-guard";
type UpscaleScale = 2 | 4;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

interface UpscaleBody {
  sourceImageId?: string;
  scale?: number;
  enhance?: boolean;
}

export async function POST(req: Request) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: UpscaleBody;
  try {
    body = (await req.json()) as UpscaleBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.sourceImageId || typeof body.sourceImageId !== "string") {
    return NextResponse.json(
      { error: "missing_source_image_id" },
      { status: 400 },
    );
  }

  const scale = (body.scale === 4 ? 4 : 2) as UpscaleScale;

  try {
    return NextResponse.json(
      await upscaleImage({
        sourceImageId: body.sourceImageId,
        scale,
        enhance: body.enhance,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[images/upscale] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
