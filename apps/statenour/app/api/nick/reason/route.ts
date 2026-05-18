/**
 * POST /api/nick/reason · Phase H (2026-05-18 PM)
 *
 * Charizard endpoint · runs the Nick Reasoning Engine for a given
 * question and returns the full ReasoningResult (trace + answer +
 * confidence + cost).
 *
 * Body shape:
 *   { question: string, brainContext?: string, tier?: "quick"|"standard"|"deep"|"thorough" }
 *
 * Returns the engine's structured result · the operator-facing UI
 * renders the trace as a step-by-step "watch Nick think" surface.
 *
 * Owner-only · same auth as the rest of the operator endpoints.
 *
 * No streaming yet (v1 returns once the engine finishes). Streaming
 * is a follow-up because most steps are atomic LLM calls anyway ·
 * the operator gets the full trace in one round trip.
 *
 * See: lib/ai/reasoning/engine.ts
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { reason } from "@/lib/ai/reasoning/engine";
import { classifyReasoning } from "@/lib/ai/reasoning/classifier";
import { checkBudget } from "@/lib/ai/reasoning/budget";
import type { ReasoningTier } from "@/lib/ai/reasoning/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Deep tier can take 8-15s · thorough tier can take 30-60s · pick a
// generous budget so the engine has room to finish without the
// platform timing it out mid-step. The engine itself has a 90s guard.
export const maxDuration = 120;

const VALID_TIERS = new Set<ReasoningTier>([
  "quick",
  "standard",
  "deep",
  "thorough",
]);

interface ReasonBody {
  question?: unknown;
  brainContext?: unknown;
  tier?: unknown;
  /** H.3.4 · operator must explicitly confirm runs at mega tier · the
   *  UI flips this true after a confirm dialog. Without it, mega
   *  requests get rejected with 402 (cost gate). */
  confirmExpensive?: unknown;
}

export async function POST(req: Request) {
  try {
    await requireSession(req);
    let body: ReasonBody;
    try {
      body = (await req.json()) as ReasonBody;
    } catch {
      return NextResponse.json(
        { error: "invalid_json", message: "Body must be valid JSON" },
        { status: 400 },
      );
    }

    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json(
        { error: "question_required", message: "Body.question is required" },
        { status: 400 },
      );
    }
    if (question.length > 4000) {
      return NextResponse.json(
        { error: "question_too_long", message: "Body.question must be ≤4000 chars" },
        { status: 400 },
      );
    }

    const brainContext =
      typeof body.brainContext === "string" && body.brainContext.length <= 8000
        ? body.brainContext
        : undefined;

    const requestedTier =
      typeof body.tier === "string" && VALID_TIERS.has(body.tier as ReasoningTier)
        ? (body.tier as ReasoningTier)
        : undefined;

    // H.3.4 · mega-tier confirm gate. If operator picked mega (or the
    // classifier returns mega via a marker), require confirmExpensive=true.
    // Auto-classifier never picks mega so this only fires on explicit
    // tier or marker matches.
    const effectiveTier =
      requestedTier ?? classifyReasoning(question).tier;
    if (effectiveTier === "mega" && body.confirmExpensive !== true) {
      return NextResponse.json(
        {
          error: "confirm_expensive",
          message:
            "Mega tier runs $0.20+ per call. Re-send with confirmExpensive=true to proceed.",
          tier: "mega",
          estimatedUsd: 0.25,
        },
        { status: 402 },
      );
    }

    // H.3.3 · daily budget cap. Read today's persisted spend, reject if
    // this run would push past the cap. Endpoint returns 402 so the UI
    // can render a "today's budget exhausted · resets at midnight ET"
    // message instead of a generic 500.
    const budget = await checkBudget(effectiveTier);
    if (!budget.allow) {
      return NextResponse.json(
        {
          error: "budget_exceeded",
          message: budget.reason,
          spentTodayUsd: budget.spentTodayUsd,
          capUsd: budget.capUsd,
          estimatedRunUsd: budget.estimatedRunUsd,
        },
        { status: 402 },
      );
    }

    const result = await reason({ question, brainContext, tier: requestedTier });
    return NextResponse.json(result, {
      // Reasoning results are user-specific + time-sensitive · don't cache.
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error: "reasoning_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
