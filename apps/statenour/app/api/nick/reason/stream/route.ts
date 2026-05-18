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
import { sanitizeError } from "@/lib/ai/reasoning/error-sanitizer";
import { reasonStreaming } from "@/lib/ai/reasoning/engine";
import { classifyReasoning } from "@/lib/ai/reasoning/classifier";
import {
  checkBudget,
  reserveBudget,
  releaseReservation,
} from "@/lib/ai/reasoning/budget";
import type { ReasoningTier } from "@/lib/ai/reasoning/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Mega tier can take 60-120s · the SSE connection needs to stay open.
export const maxDuration = 180;

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
  /** H.3.4 · explicit operator ack for mega-tier spend */
  confirmExpensive?: unknown;
  /** H.7.3 · opt out of trace persistence for sensitive runs */
  persist?: unknown;
}

function detectPrivateMarker(text: string): boolean {
  return /\b(@private|\/private)\b/i.test(text);
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

    // H.3.3 + H.6.2 · daily budget cap with in-flight reservations
    const budget = await checkBudget(effectiveTier);
    if (!budget.allow) {
      return new Response(
        JSON.stringify({
          error: "budget_exceeded",
          message: budget.reason,
          spentTodayUsd: budget.spentTodayUsd,
          inFlightUsd: budget.inFlightUsd,
          capUsd: budget.capUsd,
          estimatedRunUsd: budget.estimatedRunUsd,
        }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    }

    // H.6.2 · reserve headroom before opening the stream. Released
    // in the finally of the stream's start callback (which runs
    // whether the engine succeeds, fails, or the client disconnects).
    const reservation = await reserveBudget(effectiveTier, budget.estimatedRunUsd);

    // Re-resolve `tier` for the inner stream after the gates pass
    const tier = requestedTier;
    // H.7.3 · persist flag · explicit override or auto-detect marker
    const persist =
      body.persist === false
        ? false
        : body.persist === true
          ? true
          : !detectPrivateMarker(question);

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

        // H.6.1 · SSE keepalive · proxies (nginx, Cloudflare) often
        // drop idle SSE connections at 30-60s. Mega tier can run
        // 60-120s with multi-second gaps between steps. Ping every
        // 15s with an SSE comment line which EventSource ignores
        // but keeps the connection alive.
        const keepalive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch {
            // Client gone · let the next step/close handle teardown
          }
        }, 15_000);

        // Initial heartbeat so the client knows the connection opened.
        send("open", { startedAt: new Date().toISOString() });

        try {
          const result = await reasonStreaming(
            { question, brainContext, tier, persist },
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
          clearInterval(keepalive);
          // H.6.2 · release reservation whether engine succeeded or not
          void releaseReservation(reservation);
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
    // H.7.1 · sanitize
    const { publicMessage, errorId } = sanitizeError(err, {
      route: "/api/nick/reason/stream",
      op: "POST",
    });
    return new Response(
      JSON.stringify({
        error: "stream_init_failed",
        message: publicMessage,
        errorId,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
