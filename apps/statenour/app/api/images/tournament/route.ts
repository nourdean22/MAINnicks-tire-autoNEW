// /api/images/tournament — generate 3 image variants + auto-pick winner.
//
// v7 · BATCH 7 · Apr 28. Takes a single prompt, generates 3 variants in
// parallel (different speed modes for variety), scores each variant via
// a fast vision-model rubric, returns all 3 + the winner pick + the
// rubric for each.
//
// The rubric is intentionally simple (clarity + brand fit + readability).
// Nour can override the auto-pick by tapping any variant.
//
// Cost: 3 × image gen + 3 × vision-classify ≈ $0.10-$0.15 per tournament.
// Use case: high-stakes posts (paid ad, billboard, hero image), not drafts.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { generateVeniceImage, type ImageSpeedMode } from "@/lib/ai/venice-image";
import { trackGeneration } from "@/lib/ai/track";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

interface TournamentBody {
  prompt?: string;
  /** Number of variants — default 3, max 5 */
  count?: number;
}

interface VariantResult {
  imageUrl: string;
  imageId: string;
  model: string;
  speed: ImageSpeedMode;
  score: number;          // 0-100
  rubric: {
    clarity: number;
    brandFit: number;
    readability: number;
    professional: number;
  };
  rationale: string;
  isWinner: boolean;
}

const RUBRIC_PROMPT = `Score this auto-shop marketing image on a 0-100 scale across 4 axes:
1. CLARITY — is the subject crisp and identifiable?
2. BRAND_FIT — does it match Nick's Tire (gold #FDB913 on black, professional, Cleveland-indie-shop aesthetic)?
3. READABILITY — if there's text, is it legible? If no text, is the focal point obvious?
4. PROFESSIONAL — does it look like a real shop's content vs amateur?

Return ONLY valid JSON:
{
  "clarity": 0-100,
  "brandFit": 0-100,
  "readability": 0-100,
  "professional": 0-100,
  "rationale": "1-2 sentence explanation"
}`;

async function scoreVariant(imageUrl: string): Promise<VariantResult["rubric"] & { rationale: string }> {
  const ollamaKey = process.env.OLLAMA_API_KEY;
  const ollamaBase = process.env.OLLAMA_BASE_URL || "https://ollama.com";

  // Resolve to absolute URL for Ollama vision API
  const absoluteUrl = imageUrl.startsWith("/")
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? "https://autonicks.com"}${imageUrl}`
    : imageUrl;

  if (ollamaKey && ollamaKey.length > 20) {
    try {
      const res = await fetch(`${ollamaBase}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ollamaKey}`,
        },
        body: JSON.stringify({
          model: "qwen3-vl:235b-instruct",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: RUBRIC_PROMPT },
                { type: "image_url", image_url: { url: absoluteUrl } },
              ],
            },
          ],
          temperature: 0.2,
          max_tokens: 200,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim() ?? "";
        const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
        try {
          const parsed = JSON.parse(cleaned);
          return {
            clarity: Math.min(100, Math.max(0, Number(parsed.clarity) || 50)),
            brandFit: Math.min(100, Math.max(0, Number(parsed.brandFit) || 50)),
            readability: Math.min(100, Math.max(0, Number(parsed.readability) || 50)),
            professional: Math.min(100, Math.max(0, Number(parsed.professional) || 50)),
            rationale: String(parsed.rationale ?? "").slice(0, 200),
          };
        } catch {
          // Fall through
        }
      }
    } catch {
      // network or timeout — fall through
    }
  }

  // Fallback — neutral 50s
  return {
    clarity: 50,
    brandFit: 50,
    readability: 50,
    professional: 50,
    rationale: "vision scorer unavailable; default neutral score",
  };
}

export async function POST(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  let body: TournamentBody;
  try {
    body = (await req.json()) as TournamentBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.prompt || body.prompt.trim().length === 0) {
    return NextResponse.json({ error: "missing_prompt" }, { status: 400 });
  }

  const count = Math.max(2, Math.min(5, body.count ?? 3));
  const speeds: ImageSpeedMode[] = ["fast", "balanced", "quality", "balanced", "fast"];

  const t0 = Date.now();

  // Generate all variants in parallel
  const generated = await Promise.allSettled(
    Array.from({ length: count }, (_, i) =>
      generateVeniceImage(body.prompt!, { speed: speeds[i] ?? "balanced", autoAspect: true }),
    ),
  );
  const successes = generated
    .filter((g, i): g is PromiseFulfilledResult<Awaited<ReturnType<typeof generateVeniceImage>>> => g.status === "fulfilled")
    .map((g, i) => ({ image: g.value, speed: speeds[i] ?? "balanced" }));

  if (successes.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "all variants failed to generate",
      results: [],
    }, { status: 502 });
  }

  // Score all variants in parallel via vision rubric
  const scored = await Promise.all(
    successes.map(async ({ image, speed }) => {
      const rubric = await scoreVariant(image.imageUrl);
      const score = Math.round(
        rubric.clarity * 0.25
        + rubric.brandFit * 0.35
        + rubric.readability * 0.20
        + rubric.professional * 0.20,
      );
      return {
        imageUrl: image.imageUrl,
        imageId: image.imageId,
        model: image.model,
        speed,
        score,
        rubric: {
          clarity: rubric.clarity,
          brandFit: rubric.brandFit,
          readability: rubric.readability,
          professional: rubric.professional,
        },
        rationale: rubric.rationale,
        isWinner: false,
      } as VariantResult;
    }),
  );

  // Pick winner — highest weighted score
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 0) scored[0].isWinner = true;

  // Track in cost ledger
  for (const s of scored) {
    void trackGeneration({
      feature: "image_tournament",
      model: s.model,
      promptTokens: s.speed === "fast" ? 10_000 : 50_000,
      durationMs: Math.round((Date.now() - t0) / scored.length),
      status: "complete",
    });
  }

  return NextResponse.json({
    ok: true,
    prompt: body.prompt,
    count: scored.length,
    durationMs: Date.now() - t0,
    winner: scored[0],
    results: scored,
  });
}
