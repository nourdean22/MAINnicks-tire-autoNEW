/**
 * /api/images/variations — re-roll an image with same prompt, different seed.
 *
 * v6 · BATCH 3 · Apr 28. Powers the "vary" button on rendered images.
 * Takes a sourceImageId, looks up the original prompt, and runs
 * generateVeniceImage with the same prompt N times to produce variants.
 *
 * Phase II (2026-05-18 PM) · heavy lifting moved to
 * `lib/services/image-actions.varyImage` so both this REST endpoint
 * AND the new `trpc.chat.varyImage` mutation call the same function
 * · drift between the two consumers is structurally impossible.
 * Stays mounted for back-compat with any non-tRPC consumer.
 *
 * Pricing: same as a fresh generate per variant (recraft-v4 ≈ $0.05).
 * Auth: session. Rate limit: existing image-gen rate limit covers this.
 */

import { NextResponse } from "next/server";
import { varyImage, SourceImageNotFoundError } from "@/lib/services/image-actions";
import { requireSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

interface VariationsBody {
  sourceImageId?: string;
  count?: number;
  speed?: "fast" | "balanced" | "quality";
}

export async function POST(req: Request) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: VariationsBody;
  try {
    body = (await req.json()) as VariationsBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.sourceImageId) {
    return NextResponse.json(
      { error: "missing_source_image_id" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await varyImage({
        sourceImageId: body.sourceImageId,
        count: body.count,
        speed: body.speed,
      }),
    );
  } catch (err) {
    if (err instanceof SourceImageNotFoundError) {
      return NextResponse.json({ error: "source_not_found" }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[images/variations] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
