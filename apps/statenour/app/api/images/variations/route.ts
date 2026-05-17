/**
 * /api/images/variations — re-roll an image with same prompt, different seed.
 *
 * v6 · BATCH 3 · Apr 28. Powers the "vary" button on rendered images.
 * Takes a sourceImageId, looks up the original prompt, and runs
 * generateVeniceImage with the same prompt N times to produce variants.
 *
 * Pricing: same as a fresh generate per variant (recraft-v4 ≈ $0.05).
 *
 * Auth: session. Rate limit: existing image-gen rate limit covers this.
 */

import { NextResponse } from "next/server";
import { generateVeniceImage } from "@/lib/ai/venice-image";
import { prisma } from "@/lib/prisma";
import { trackGeneration } from "@/lib/ai/track";
import { requireSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

interface VariationsBody {
  sourceImageId?: string;
  count?: number;
  /** Optional speed override — fast (z-image-turbo) for cheap variants */
  speed?: "fast" | "balanced" | "quality";
}

export async function POST(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  let body: VariationsBody;
  try {
    body = (await req.json()) as VariationsBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.sourceImageId) {
    return NextResponse.json({ error: "missing_source_image_id" }, { status: 400 });
  }

  const count = Math.max(1, Math.min(4, body.count ?? 2));

  // Pull the original prompt + size from the source image record
  const source = await prisma.auditEvent.findUnique({
    where: { id: body.sourceImageId },
    select: { detail: true, payload: true },
  });
  if (!source) {
    return NextResponse.json({ error: "source_not_found" }, { status: 404 });
  }
  const sourcePayload = source.payload as { size?: string };
  const originalPrompt = source.detail ?? "(no prompt available)";
  // v10.0.479 · size enum updated to flux-2-pro accepted values.
  // Legacy DB rows may still hold "1024x768" / "768x1024" · map them
  // to the closest new shape so variations of older images don't 400.
  const rawSize = sourcePayload.size ?? "1024x1024";
  const sourceSize: "512x512" | "1024x1024" | "1536x1024" | "1024x1536" =
    rawSize === "1024x768" ? "1536x1024"
    : rawSize === "768x1024" ? "1024x1536"
    : (["512x512", "1024x1024", "1536x1024", "1024x1536"].includes(rawSize)
        ? (rawSize as "512x512" | "1024x1024" | "1536x1024" | "1024x1536")
        : "1024x1024");

  // Generate variations in parallel — Venice can handle ~3-4 concurrent
  // image gens for the same key without rate-limiting issues. Speed mode
  // applied uniformly so all variants are equivalent.
  const t0 = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: count }, () =>
      generateVeniceImage(originalPrompt, {
        size: sourceSize,
        speed: body.speed ?? "fast", // default fast for cheap A/B
      }),
    ),
  );

  const successes = results
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof generateVeniceImage>>> => r.status === "fulfilled")
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

  return NextResponse.json({
    ok: true,
    sourceImageId: body.sourceImageId,
    count: successes.length,
    failed: failures,
    durationMs: Date.now() - t0,
    images: successes.map((r) => ({
      imageUrl: r.imageUrl,
      imageId: r.imageId,
      model: r.model,
      size: r.size,
    })),
  });
}
