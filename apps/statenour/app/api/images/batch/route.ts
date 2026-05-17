/**
 * /api/images/batch — multi-image carousel generator.
 *
 * v6 · BATCH 3 · Apr 28. Takes an array of scene prompts and returns
 * an array of image results. Used by /carousel slash command + the
 * carousel-mode flow on the chat surface.
 *
 * Body: { prompts: string[], speed?: "fast" | "balanced" | "quality", size? }
 *
 * Generates in parallel with concurrency=3 to balance Venice rate
 * limits + total wall time (5 scenes at 10s each in parallel = ~12s
 * vs sequential 50s).
 *
 * Auth: session.
 */

import { NextResponse } from "next/server";
import { generateVeniceImage, type ImageSpeedMode } from "@/lib/ai/venice-image";
import { trackGeneration } from "@/lib/ai/track";
import { requireSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

interface BatchBody {
  prompts?: string[];
  speed?: ImageSpeedMode;
  size?: "512x512" | "1024x1024" | "1536x1024" | "1024x1536";
  /** Apr 28 · concurrency cap — 3 keeps us under Venice rate limits */
  concurrency?: number;
}

const MAX_PROMPTS = 10;
const DEFAULT_CONCURRENCY = 3;

export async function POST(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  let body: BatchBody;
  try {
    body = (await req.json()) as BatchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!Array.isArray(body.prompts) || body.prompts.length === 0) {
    return NextResponse.json({ error: "missing_prompts" }, { status: 400 });
  }

  const prompts = body.prompts.slice(0, MAX_PROMPTS).filter((p) => typeof p === "string" && p.trim().length > 0);
  if (prompts.length === 0) {
    return NextResponse.json({ error: "no_valid_prompts" }, { status: 400 });
  }

  const concurrency = Math.max(1, Math.min(5, body.concurrency ?? DEFAULT_CONCURRENCY));
  const t0 = Date.now();

  // Concurrency-limited parallel generation. Awaits in batches of `concurrency`
  // so Venice doesn't see 10 simultaneous requests at once.
  const results: Array<{
    index: number;
    success: boolean;
    imageUrl?: string;
    imageId?: string;
    model?: string;
    size?: string;
    error?: string;
  }> = new Array(prompts.length);

  for (let i = 0; i < prompts.length; i += concurrency) {
    const slice = prompts.slice(i, i + concurrency);
    const sliceResults = await Promise.allSettled(
      slice.map((prompt) =>
        generateVeniceImage(prompt, {
          speed: body.speed ?? "balanced",
          size: body.size,
        }),
      ),
    );
    for (let j = 0; j < sliceResults.length; j++) {
      const r = sliceResults[j];
      const idx = i + j;
      if (r.status === "fulfilled") {
        results[idx] = {
          index: idx,
          success: true,
          imageUrl: r.value.imageUrl,
          imageId: r.value.imageId,
          model: r.value.model,
          size: r.value.size,
        };
        void trackGeneration({
          feature: "image_batch",
          model: r.value.model,
          promptTokens: r.value.model === "z-image-turbo" ? 10_000 : 50_000,
          outputTokens: 0,
          durationMs: Math.round((Date.now() - t0) / prompts.length),
          status: "complete",
        });
      } else {
        results[idx] = {
          index: idx,
          success: false,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        };
        void trackGeneration({
          feature: "image_batch",
          model: "venice-image",
          durationMs: Date.now() - t0,
          status: "error",
        });
      }
    }
  }

  const successes = results.filter((r) => r.success).length;
  return NextResponse.json({
    ok: true,
    requested: prompts.length,
    succeeded: successes,
    failed: prompts.length - successes,
    durationMs: Date.now() - t0,
    results,
  });
}
