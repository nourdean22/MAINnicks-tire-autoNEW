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
 * misc-pages slice (2026-05-22 · legacy-modernizer REST→tRPC) · the
 * vision-analysis + rebrand pipeline moved to the shared
 * `lib/services/photo-improver` module the `operator.improvePhoto`
 * tRPC procedure also calls · drift structurally impossible. The route
 * stays mounted as the rollback path.
 *
 * Auth: session.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { improvePhoto, MissingImageError } from "@/lib/services/photo-improver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

interface ImproveBody {
  imageBase64?: string;
  imageUrl?: string;
  mode?: "analyze" | "rebrand" | "both";
}

export async function POST(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  let body: ImproveBody;
  try {
    body = (await req.json()) as ImproveBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await improvePhoto({
      imageBase64: body.imageBase64,
      imageUrl: body.imageUrl,
      mode: body.mode,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MissingImageError) {
      return NextResponse.json({ error: "missing_image" }, { status: 400 });
    }
    throw err;
  }
}
