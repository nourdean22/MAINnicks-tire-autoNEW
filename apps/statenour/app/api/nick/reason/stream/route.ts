/**
 * POST /api/nick/reason/stream · Phase H.2 (2026-05-18 PM)
 *
 * Server-Sent Events variant of /api/nick/reason. Emits one event per
 * reasoning step AS IT LANDS, then a final "result" event with the
 * complete trace + answer + cost.
 *
 * Event types (SSE `event:` field):
 *   · step    · { kind, label, detail, elapsedMs, durationMs }
 *   · result  · { trace, tier, classifierReason } — full ReasoningResult
 *   · error   · { error, message }
 *   · done    · empty payload · signals client to close
 *
 * Same auth + validation as the non-streaming endpoint. Owner-only.
 *
 * The operator-facing UI uses EventSource to consume this so each step
 * appears on the trace as Nick thinks · matches the "watch Nick
 * think" promise of the /reason surface.
 */

import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { reasonStreaming } from "@/lib/ai/reasoning/engine";
import { classifyReasoning } from "@/lib/ai/reasoning/classifier";
import { checkBudget } from "@/lib/ai/reasoning/budget";
import type { ReasoningTier } from "@/lib/ai/reasoning/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Mega tier can take 60-120s · the SSE connection needs to stay open.
export const maxDuration = 180;

const VALID_TIERS = new Set<ReasoningTier>([
  "quick",
  "standard",
  "deep",
  "thorough",
  "mega",
]);

interface ReasonBody {
  question?: unknown;
  brainContext?: unknown;
  tier?: unknown;
  /** H.3.4 · explicit operator ack for mega-tier spend */
  confirmExpensive?: unknown;
}

function sseEvent(eventName: string, data: unknown): string {
  const json = JSON.stringify(data);
  return `event: ${eventName}\ndata: ${json}\n\n`;
}

export async function POST(req: Request) {
  try {
    await requireSession(req);
    let body: ReasonBody;
    try {
      body = (await req.json()) as ReasonBody;
    } catch {
      return new Response(
        JSON.stringify({ error: "invalid_json", message: "Body must be valid JSON" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return new Response(
        JSON.stringify({ error: "question_required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    if (question.length > 4000) {
      return new Response(
        JSON.stringify({ error: "question_too_long" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
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

    // H.3.4 · mega-tier confirm gate (SSE variant returns the gate as
    // a 402 JSON · the SSE stream never opens for ungated mega requests)
    const effectiveTier = requestedTier ?? classifyReasoning(question).tier;
    if (effectiveTier === "mega" && body.confirmExpensive !== true) {
      return new Response(
        JSON.stringify({
          error: "confirm_expensive",
          message: "Mega tier runs $0.20+ per call. Re-send with confirmExpensive=true.",
          tier: "mega",
          estimatedUsd: 0.25,
        }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    }

    // H.3.3 · daily budget cap · gate before opening the SSE stream
    const budget = await checkBudget(effectiveTier);
    if (!budget.allow) {
      return new Response(
        JSON.stringify({
          error: "budget_exceeded",
          message: budget.reason,
          spentTodayUsd: budget.spentTodayUsd,
          capUsd: budget.capUsd,
          estimatedRunUsd: budget.estimatedRunUsd,
        }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    }

    // Re-resolve `tier` for the inner stream after the gates pass
    const tier = requestedTier;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (eventName: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(sseEvent(eventName, data)));
          } catch {
            // Client may have disconnected · ignore.
          }
        };

        // Initial heartbeat so the client knows the connection opened.
        send("open", { startedAt: new Date().toISOString() });

        try {
          const result = await reasonStreaming(
            { question, brainContext, tier },
            (step) => send("step", step),
          );
          send("result", result);
          send("done", {});
        } catch (err) {
          send("error", {
            error: "reasoning_failed",
            message: err instanceof Error ? err.message : String(err),
          });
        } finally {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // disable nginx buffering if behind one
      },
    });
  } catch (err) {
    if (err instanceof ServiceError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        error: "stream_init_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
