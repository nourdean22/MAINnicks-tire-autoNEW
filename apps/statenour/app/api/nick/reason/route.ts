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
import { sanitizeError } from "@/lib/ai/reasoning/error-sanitizer";
import { reason } from "@/lib/ai/reasoning/engine";
import { classifyReasoning } from "@/lib/ai/reasoning/classifier";
import {
  checkBudget,
  reserveBudget,
  releaseReservation,
} from "@/lib/ai/reasoning/budget";
import {
  lookupIdempotency,
  reserveIdempotency,
  storeIdempotencyResult,
  releaseIdempotency,
  hashRequest,
  pruneStaleIdempotency,
} from "@/lib/ai/reasoning/idempotency";
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
  "smart",
  "deep",
  "thorough",
  "mega",
]);

interface ReasonBody {
  question?: unknown;
  brainContext?: unknown;
  tier?: unknown;
  /** H.3.4 · operator must explicitly confirm runs at mega tier · the
   *  UI flips this true after a confirm dialog. Without it, mega
   *  requests get rejected with 402 (cost gate). */
  confirmExpensive?: unknown;
  /** H.7.3 · operator opts the run out of trace persistence (sensitive
   *  questions about personal/financial/relational topics that
   *  shouldn't sit in BrainMemory for 30 days). Also auto-set when the
   *  question contains @private or /private. */
  persist?: unknown;
}

/** H.7.3 · detect operator privacy marker · matches @private or
 *  /private as whole-word case-insensitive · returns true to suppress
 *  trace persistence. Used as the auto-default if body.persist is
 *  not explicitly passed. */
function detectPrivateMarker(text: string): boolean {
  return /\b(@private|\/private)\b/i.test(text);
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

    // N.1 · idempotency check · Idempotency-Key header from client
    // prevents double-tap from charging twice. Same-key requests
    // return cached result (or "still in-flight" 425) without
    // re-running the engine.
    const idemKey = req.headers.get("idempotency-key");
    if (idemKey) {
      // Opportunistic TTL prune · ~10% sample
      if (Math.random() < 0.1) void pruneStaleIdempotency();
      const requestHash = hashRequest({
        question,
        brainContext,
        tier: requestedTier,
      });
      const existing = await lookupIdempotency(idemKey);
      if (existing?.result) {
        // Cached completed result · return immediately · no charge
        return NextResponse.json(existing.result, {
          headers: {
            "Cache-Control": "private, no-store",
            "X-Idempotent-Replay": "true",
          },
        });
      }
      if (existing?.inFlight) {
        // First request is still running · tell client to retry shortly
        return NextResponse.json(
          {
            error: "in_flight",
            message:
              "A request with this idempotency key is still running. Poll again in 2s.",
            firstSeenAt: existing.firstSeenAt,
          },
          { status: 425, headers: { "Retry-After": "2" } },
        );
      }
      // First time seeing this key · reserve it · we'll store the
      // result when the engine finishes (or release on failure).
      await reserveIdempotency(idemKey, requestHash);
    }

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

    // H.3.3 · daily budget cap · H.6.2 closes TOCTOU by including
    // in-flight reservations in the cap check. Read today's persisted
    // spend + in-flight, reject if this run would push past the cap.
    // Returns 402 so the UI can render a budget-exhausted state.
    const budget = await checkBudget(effectiveTier);
    if (!budget.allow) {
      return NextResponse.json(
        {
          error: "budget_exceeded",
          message: budget.reason,
          spentTodayUsd: budget.spentTodayUsd,
          inFlightUsd: budget.inFlightUsd,
          capUsd: budget.capUsd,
          estimatedRunUsd: budget.estimatedRunUsd,
        },
        { status: 402 },
      );
    }

    // H.6.2 · reserve headroom BEFORE the engine runs · next concurrent
    // request will see this reservation in its checkBudget. Released
    // in the finally block so a crashed engine doesn't leak the slot
    // (and the TTL prune cleans up if release itself fails).
    const reservation = await reserveBudget(effectiveTier, budget.estimatedRunUsd);
    // H.7.3 · resolve persist flag · explicit body.persist wins · else
    // auto-detect @private / /private marker in the question.
    const persist =
      body.persist === false
        ? false
        : body.persist === true
          ? true
          : !detectPrivateMarker(question);
    let runFailed = false;
    try {
      const result = await reason({
        question,
        brainContext,
        tier: requestedTier,
        persist,
      });
      // N.1 · store the result under the idempotency key · subsequent
      // requests with the same key return this without re-running.
      if (idemKey) {
        void storeIdempotencyResult(idemKey, result);
      }
      return NextResponse.json(result, {
        // Reasoning results are user-specific + time-sensitive · don't cache.
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (err) {
      runFailed = true;
      throw err;
    } finally {
      void releaseReservation(reservation);
      // N.1 · release the idempotency reservation on failure so the
      // operator can retry with the same key · successful runs already
      // updated the row above via storeIdempotencyResult.
      if (idemKey && runFailed) {
        void releaseIdempotency(idemKey);
      }
    }
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // H.7.1 · sanitize · raw err.message could leak Prisma internals,
    // provider URLs, partial prompts. sanitizeError logs the full
    // error internally + returns a generic operator-readable message.
    const { publicMessage, errorId } = sanitizeError(err, {
      route: "/api/nick/reason",
      op: "POST",
    });
    return NextResponse.json(
      { error: "reasoning_failed", message: publicMessage, errorId },
      { status: 500 },
    );
  }
}
